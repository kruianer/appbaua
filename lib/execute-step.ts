import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import { type RunLogEntry, RECURRING_MD } from "./run-log";
import {
  IDEA_DIRECTION_FILE,
  doneDir,
  failedDir,
  inProgressDir,
  newMdFiles,
  oldestMd,
  ranTodayForRepo,
  readyDir,
  runsOncePerDay,
  sourceFor,
} from "./task-source";
import {
  NO_CHANGES_DETAIL,
  commitAndPush,
  discardChanges,
  headCommit,
  listReady,
  moveMd,
  prepareRepo,
  readRepoFile,
  repoPathExists,
  writeRepoFile,
} from "./workspace";
import {
  NO_IDEA_MESSAGE,
  docPrompt,
  fileTaskPrompt,
  ideaPrompt,
  recurringPrompt,
  runClaude,
  securityPrompt,
} from "./claude-runner";
import { REPORT_DIR, reportContent, reportPath } from "./review-report";
import {
  DOC_SITE_FILE,
  DOC_UNCHANGED_MESSAGE,
  DONE_REQUIREMENTS_DIR,
  NO_DESIGN_MESSAGE,
  USER_DOCS_DIR,
  designDirFrom,
} from "./doc-site";
import {
  SECURITY_OK_MESSAGE,
  SECURITY_POLICY_FILE,
  SECURITY_REPORT_DIR,
  hasSecurityFindings,
} from "./security-report";
import { setCurrentMd, setCurrentOutput } from "./worker-status";

// Orchestrates one real execution step (req-006). Returns a decision the loop
// logs. "skip" means no log entry (nothing to do); "success"/"error" produce a
// log entry. Side effects (clone, claude, push, move) go through injectable
// deps so this is unit-testable without git or the CLI.
//
// req-008 adds observability: a file-driven step moves its .md through
// ready/ -> in-progress/ -> done|failed/, publishes the filename and the live
// Claude output to the worker status, and puts back .md files a crashed run
// left behind in in-progress/.
//
// req-010 makes the result of a recurring analysis task durable: such a step
// produces a report instead of code, so the full report is written to
// delivery/reviews/ in the target repo and pushed like any other change. The
// run log keeps only its short message.
//
// bug-002 makes failure durable too: a .md whose run failed is parked in
// failed/ with its own commit, so the next pass does not pick it up again.
//
// req-011 adds the Ideen task: once per repo and calendar day, Claude proposes
// exactly one new idea as a file in delivery/idea/. Whether that happened is
// decided by comparing the folder before and after the run, not by reading
// Claude's answer — so "keine neue Idee gefunden" is a fact, not a phrasing.
//
// req-014 adds the Security task: once per repo and calendar day, Claude checks
// the repo against delivery/security.md. It changes no code — whatever the run
// touched is discarded — and it files a report in delivery/security/ only when
// it found something; a clean check leaves nothing behind but a log line.
//
// req-016 adds the Doku task: once per repo and calendar day, Claude updates
// the multi-page user documentation under site/user-docs/. It runs only when the
// repo's delivery/doc-site.md points at a design template that actually exists —
// without one the step does nothing at all and says so in the Verlauf.
//
// req-015 carries the .md name out to the caller, so the run log can store it
// on the entry and the Verlauf can name the file a run worked off — the same
// information the Aktivität tab shows while the step is still running.

export type StepDecision =
  | { kind: "skip" }
  /** `md`: the .md worked off, RECURRING_MD when the type has none (req-015). */
  | { kind: "success"; message: string; md?: string | null }
  | { kind: "error"; message: string; md?: string | null };

export type ExecuteDeps = {
  prepareRepo: typeof prepareRepo;
  listReady: typeof listReady;
  runClaude: typeof runClaude;
  commitAndPush: typeof commitAndPush;
  moveMd: typeof moveMd;
  /** Drop what a failed run left in the working copy (bug-002). */
  discardChanges: typeof discardChanges;
  /** Which commit a filed report describes (req-010). */
  headCommit: typeof headCommit;
  /** Write the report file into the repo working copy (req-010). */
  writeRepoFile: typeof writeRepoFile;
  /** Read the repo's doc-site spec (req-016). */
  readRepoFile: typeof readRepoFile;
  /** Is the design template the spec names actually there (req-016)? */
  repoPathExists: typeof repoPathExists;
  /** Publish the .md this step works on (req-008). */
  setCurrentMd: typeof setCurrentMd;
  /** Publish the live Claude output tail of this step (req-008). */
  setCurrentOutput: typeof setCurrentOutput;
  now: () => Date;
  token: string | undefined;
};

const defaultDeps = (): ExecuteDeps => ({
  prepareRepo,
  listReady,
  runClaude,
  commitAndPush,
  moveMd,
  discardChanges,
  headCommit,
  writeRepoFile,
  readRepoFile,
  repoPathExists,
  setCurrentMd,
  setCurrentOutput,
  now: () => new Date(),
  token: process.env.GITHUB_TOKEN,
});

export async function executeStep(
  repo: Repo,
  taskType: TaskType,
  recentLog: RunLogEntry[],
  deps: Partial<ExecuteDeps> = {},
): Promise<StepDecision> {
  const d: ExecuteDeps = { ...defaultDeps(), ...deps };
  const src = sourceFor(taskType.id);

  // The work item, claimed further below. Declared up here so every decision
  // can report it (req-015) — including the ones taken before a claim happens.
  let mdName: string | null = null;
  let mdRel: string | null = null;
  /**
   * What this run should be filed under in the Verlauf (req-015): the claimed
   * .md for a file-driven type, the recurring marker for every other type, and
   * null while a file-driven step has not claimed anything yet — an aborted
   * step names no file, because it worked on none.
   */
  const runMd = (): string | null =>
    src.kind === "file" ? mdName : RECURRING_MD;

  if (!d.token) {
    return {
      kind: "error",
      message: "Kein GitHub-Token für Push konfiguriert",
      md: runMd(),
    };
  }
  // Bound once, so every git helper below gets the credential it needs without
  // reaching for the environment again (bug-003).
  const token = d.token;

  // Types without a work-item queue (recurring, idea): skip if they already ran
  // today for this repo.
  if (runsOncePerDay(src)) {
    if (ranTodayForRepo(recentLog, repo.name, taskType.label, d.now())) {
      return { kind: "skip" };
    }
  }

  let dir: string;
  try {
    dir = await d.prepareRepo(repo.url, token);
  } catch (err) {
    return {
      kind: "error",
      message: `Repo vorbereiten fehlgeschlagen: ${String(err)}`,
      md: runMd(),
    };
  }

  // The Doku task stands or falls with the repo's design template (req-016):
  // without one it does NOTHING — no Claude run, no file, no commit — and the
  // Verlauf says why. Checked before anything else happens, so a repo that has
  // not been set up yet costs a clone and not an hour of Claude.
  let designDir: string | null = null;
  if (src.kind === "doc") {
    designDir = await docDesignDir(d, dir);
    if (!designDir) {
      return { kind: "success", message: NO_DESIGN_MESSAGE, md: runMd() };
    }
  }

  // Pick the work item and claim it by moving it into in-progress/ (req-008).
  if (src.kind === "file" && src.base) {
    await requeueStale(d, dir, src.base);

    const files = await d.listReady(dir, readyDir(src.base));
    const md = oldestMd(files);
    if (!md) return { kind: "skip" }; // file-driven + empty => silent skip

    mdName = md;
    mdRel = `${inProgressDir(src.base)}/${md}`;
    try {
      await d.moveMd(dir, `${readyDir(src.base)}/${md}`, mdRel);
    } catch (err) {
      return {
        kind: "error",
        message: `${md} konnte nicht nach in-progress verschoben werden: ${String(err)}`,
        md: runMd(),
      };
    }
    await d.setCurrentMd(md);
  }

  // Which ideas the repo already had, so the step can tell a proposal from an
  // empty-handed run afterwards (req-011).
  const ideasBefore =
    src.kind === "idea" && src.base ? await d.listReady(dir, src.base) : [];

  let prompt: string;
  if (src.kind === "file" && mdRel) {
    prompt = fileTaskPrompt(mdRel);
  } else if (src.kind === "idea" && src.base) {
    prompt = ideaPrompt({
      ideaDir: src.base,
      doneDir: doneDir(src.base),
      directionFile: IDEA_DIRECTION_FILE,
    });
  } else if (src.kind === "security") {
    prompt = securityPrompt({ policyFile: SECURITY_POLICY_FILE });
  } else if (src.kind === "doc" && designDir) {
    prompt = docPrompt({
      designDir,
      docSiteFile: DOC_SITE_FILE,
      docsDir: USER_DOCS_DIR,
      doneRequirementsDir: DONE_REQUIREMENTS_DIR,
    });
  } else {
    prompt = recurringPrompt(taskType.label);
  }

  // Live output: the tail arrives while Claude runs, so the status writes are
  // queued instead of awaited (a slow write must not stall the process). The
  // queue is drained before the step ends, so nothing is still in flight when
  // the loop clears the running status.
  let outputWrites: Promise<void> = Promise.resolve();
  const outcome = await d.runClaude(dir, prompt, {
    onOutput: (tail) => {
      outputWrites = outputWrites
        .then(() => d.setCurrentOutput(tail))
        .catch(() => {});
    },
  });
  await outputWrites;

  if (!outcome.ok) {
    // Park the .md under failed/ and push that move (file-driven only), so the
    // same task is not picked up again on the next pass (bug-002).
    const parked =
      src.base && mdName
        ? await parkFailed(d, dir, src.base, mdName, token)
        : "";
    return {
      kind: "error",
      message: `${outcome.summary}${parked}`,
      md: runMd(),
    };
  }

  // The Ideen task is done when a new idea file exists — or honestly done when
  // none does (req-011). Either way the day counts as used, which is what the
  // 'success' decision records in the run log.
  if (src.kind === "idea" && src.base) {
    const created = newMdFiles(ideasBefore, await d.listReady(dir, src.base));
    if (created.length === 0) {
      // Nothing was proposed, so nothing of this run belongs on dev — whatever
      // it touched along the way is dropped rather than committed.
      await d.discardChanges(dir).catch(() => {});
      return { kind: "success", message: NO_IDEA_MESSAGE, md: runMd() };
    }
    const push = await d.commitAndPush(
      dir,
      `worker: neue Idee ${created.join(", ")}`,
      token,
    );
    return {
      kind: "success",
      message: `Neue Idee: ${created.join(", ")} — ${push.detail}`,
      md: runMd(),
    };
  }

  // The Security task checks, it does not change (req-014). Whatever the run
  // touched along the way is dropped first, so the only thing that can reach
  // dev is the report written right after — and a check without findings files
  // nothing at all.
  if (src.kind === "security") {
    await d.discardChanges(dir).catch(() => {});
    if (!hasSecurityFindings(outcome.report)) {
      return { kind: "success", message: SECURITY_OK_MESSAGE, md: runMd() };
    }
    const rel = await fileReport(
      d,
      dir,
      repo,
      taskType,
      outcome.report,
      SECURITY_REPORT_DIR,
    );
    const push = await d.commitAndPush(
      dir,
      `worker: ${taskType.label}-Bericht abgelegt`,
      token,
    );
    const where = rel ? ` (Bericht: ${rel})` : "";
    return {
      kind: "success",
      message: `${outcome.summary} — ${push.detail}${where}`,
      md: runMd(),
    };
  }

  // The Doku task's result IS the site (req-016): whatever the run left under
  // site/user-docs/ gets committed and pushed, which is what triggers the dev
  // deploy. It files no report — the pages are the report. A run that found
  // nothing to add changes nothing, and that is a normal day, not a failure.
  if (src.kind === "doc") {
    const push = await d.commitAndPush(dir, "worker: Doku aktualisiert", token);
    if (push.detail === NO_CHANGES_DETAIL) {
      return { kind: "success", message: DOC_UNCHANGED_MESSAGE, md: runMd() };
    }
    return {
      kind: "success",
      message: `${outcome.summary} — ${push.detail} (Doku: ${USER_DOCS_DIR})`,
      md: runMd(),
    };
  }

  // Success: for file-driven, move in-progress -> done before committing.
  if (src.base && mdRel && mdName) {
    try {
      await d.moveMd(dir, mdRel, `${doneDir(src.base)}/${mdName}`);
    } catch {
      /* best effort */
    }
  }

  // A recurring analysis task changes no work item of its own — its result IS
  // the report. File it so it outlives the container session (req-010).
  const reportRel =
    src.kind === "recurring" && outcome.report.trim()
      ? await fileReport(d, dir, repo, taskType, outcome.report)
      : null;

  const commitMsg = mdName
    ? `worker: ${mdName} abgearbeitet`
    : `worker: ${taskType.label} durchgeführt`;
  const push = await d.commitAndPush(dir, commitMsg, token);

  // The log stays a short message; it only names the file so the full report
  // remains findable from the Verlauf (req-010).
  const note = reportRel ? ` (Bericht: ${reportRel})` : "";
  return {
    kind: "success",
    message: `${outcome.summary} — ${push.detail}${note}`,
    md: runMd(),
  };
}

/**
 * Move the .md of a failed run from ready/ to failed/ and commit that move on
 * its own (bug-002). Returns a note for the run-log message.
 *
 * The commit is what makes the failure stick: without it the next prepareRepo
 * resets ready/ back from origin, so a permanently failing task would be
 * retried on every pass forever, while its untracked failed/ copy sat around
 * waiting to be swept into an unrelated commit — the .md would then be in
 * ready/ AND failed/ at once.
 *
 * Everything the failed attempt left behind is discarded first, so the commit
 * carries the move and nothing else: a half-finished attempt must never reach
 * dev. Discarding also restores ready/<md> — the claim into in-progress/ was
 * never committed — which is where the move starts from.
 *
 * Best effort: a move or push that fails must not hide the original error, it
 * only changes the note.
 */
async function parkFailed(
  d: ExecuteDeps,
  dir: string,
  base: string,
  mdName: string,
  token: string,
): Promise<string> {
  try {
    await d.discardChanges(dir);
    await d.moveMd(
      dir,
      `${readyDir(base)}/${mdName}`,
      `${failedDir(base)}/${mdName}`,
    );
    const push = await d.commitAndPush(
      dir,
      `worker: ${mdName} fehlgeschlagen`,
      token,
    );
    return ` — ${mdName} nach failed/ verschoben (${push.detail})`;
  } catch (err) {
    return ` — ${mdName} konnte nicht nach failed/ verschoben werden: ${String(err)}`;
  }
}

/**
 * Where the repo's design template lies, or null when the Doku task must not run
 * (req-016). Null covers all three ways there can be none: no
 * delivery/doc-site.md at all, a doc-site.md that names no usable location (an
 * unfilled template placeholder is one), and a location that is not actually in
 * the repo — a spec pointing at a folder nobody uploaded is no design template
 * either, and generating a doc "so far as possible like" a template that does
 * not exist would mean inventing one.
 *
 * A read that throws counts as "none": the task doing nothing is the documented
 * behaviour for a repo without a template, and it is the safe answer here.
 */
async function docDesignDir(
  d: ExecuteDeps,
  dir: string,
): Promise<string | null> {
  const spec = await d.readRepoFile(dir, DOC_SITE_FILE).catch(() => null);
  const rel = designDirFrom(spec);
  if (!rel) return null;
  const there = await d.repoPathExists(dir, rel).catch(() => false);
  return there ? rel : null;
}

/**
 * Write Claude's full report into `folder` of the working copy — delivery/
 * reviews/ for a recurring analysis (req-010), delivery/security/ for the
 * Security task (req-014) — and return its repo-relative path. Best effort: a
 * report that cannot be written must not turn a successful review into a failed
 * step — the analysis itself did happen, and the log message then simply names
 * no file.
 */
async function fileReport(
  d: ExecuteDeps,
  dir: string,
  repo: Repo,
  taskType: TaskType,
  report: string,
  folder: string = REPORT_DIR,
): Promise<string | null> {
  try {
    const ref = {
      taskId: taskType.id,
      repoName: repo.name,
      commit: await d.headCommit(dir),
      now: d.now(),
    };
    const rel = reportPath(ref, folder);
    await d.writeRepoFile(
      dir,
      rel,
      reportContent({ ...ref, taskLabel: taskType.label, report }),
    );
    return rel;
  } catch {
    return null;
  }
}

/**
 * Put .md files a crashed or interrupted run left in in-progress/ back into
 * ready/, so they get another attempt (req-008). Best effort: a file that
 * cannot be moved must not stop the step that is about to run.
 */
async function requeueStale(
  d: ExecuteDeps,
  dir: string,
  base: string,
): Promise<void> {
  const stale = await d.listReady(dir, inProgressDir(base));
  for (const name of stale.filter((f) => f.toLowerCase().endsWith(".md"))) {
    try {
      await d.moveMd(
        dir,
        `${inProgressDir(base)}/${name}`,
        `${readyDir(base)}/${name}`,
      );
    } catch {
      /* best effort */
    }
  }
}
