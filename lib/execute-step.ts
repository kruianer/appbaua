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
  prepareRepoOnConvention,
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
  testFixPrompt,
} from "./claude-runner";
import {
  GATE_RED_MESSAGE,
  STACK_FILE,
  runTestGate,
  testGateNote,
  type TestGateResult,
} from "./test-gate";
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
  DEVOPS_FILE,
  captureDocScreenshots,
  devUrlFrom,
  screenshotNote,
  type ShotResult,
} from "./doc-screenshots";
import {
  SECURITY_OK_MESSAGE,
  SECURITY_POLICY_FILE,
  SECURITY_REPORT_DIR,
  hasSecurityFindings,
} from "./security-report";
import { setCurrentMd, setCurrentOutput } from "./worker-status";
import { isRateLimit, pauseUntilFrom } from "./rate-limit";

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
// req-017 gives that documentation pictures: right before Claude starts, the
// worker photographs the app's running dev environment into the docs folder and
// hands the resulting list over in the prompt. A picture that could not be taken
// costs its illustration and nothing else — the docs are built either way, and
// the Verlauf names every page that stayed without one.
//
// req-015 carries the .md name out to the caller, so the run log can store it
// on the entry and the Verlauf can name the file a run worked off — the same
// information the Aktivität tab shows while the step is still running.
//
// req-019 puts a gate in front of done/: a file-driven .md is only filed as
// finished after the repo's full test suite has actually run and come back
// green. A red suite gets one repair attempt in the same run; what stays red is
// not finished, so its .md is parked under failed/ like any other failure.
//
// req-020 takes two decisions away from this file. WHICH branch a step commits
// on is no longer `dev` by definition — prepareRepoOnConvention reads it from
// the target repo's own devops.md and hands it back, and every commit of this
// step goes there. And a push that did not happen is no longer a successful
// step with a remark: preparing a repo and pushing it are the two moments where
// the worker touches the outside world, so both failures become an 'error' in
// the Verlauf, naming the repo and the reason. A step that quietly reported
// success while nothing left the container is exactly the silence this
// requirement is about.

export type StepDecision =
  | { kind: "skip" }
  /** `md`: the .md worked off, RECURRING_MD when the type has none (req-015). */
  | { kind: "success"; message: string; md?: string | null }
  | { kind: "error"; message: string; md?: string | null }
  /**
   * The Claude run failed on a rate/usage limit (req-029). NOT a failure: the
   * .md stays in ready/ (never parked to failed/), and the loop pauses until
   * `pauseUntil` (epoch ms) before trying the queue again.
   */
  | { kind: "rate-limited"; message: string; pauseUntil: number; md?: string | null };

/** What the Verlauf leads with when a repo could not be made ready (req-020). */
export const PREPARE_FAILED_MESSAGE = "Repo vorbereiten fehlgeschlagen";

/** What the Verlauf leads with when the work never left the container (req-020). */
export const PUSH_FAILED_MESSAGE = "Push fehlgeschlagen";

/**
 * Phase labels so a failed run says in which step it broke (req-026): the
 * Verlauf leads with one of these, then the concrete cause. "Repo vorbereiten"
 * and "Push" already have their own messages above; these cover the rest.
 */
export const PHASE_CLAUDE = "Claude-Lauf";
export const PHASE_FILE_MOVE = "Datei verschieben";

export type ExecuteDeps = {
  /** Clone/fetch and check out the branch the target repo itself names (req-020). */
  prepareRepo: typeof prepareRepoOnConvention;
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
  /** Photograph the app's dev environment into the docs folder (req-017). */
  captureScreenshots: (dir: string, baseUrl: string | null) => Promise<ShotResult>;
  /** Run the target repo's full test suite before anything is called done (req-019). */
  runTestGate: (dir: string, stack: string | null) => Promise<TestGateResult>;
  /** Publish the .md this step works on (req-008). */
  setCurrentMd: typeof setCurrentMd;
  /** Publish the live Claude output tail of this step (req-008). */
  setCurrentOutput: typeof setCurrentOutput;
  now: () => Date;
  token: string | undefined;
};

const defaultDeps = (): ExecuteDeps => ({
  prepareRepo: prepareRepoOnConvention,
  listReady,
  runClaude,
  commitAndPush,
  moveMd,
  discardChanges,
  headCommit,
  writeRepoFile,
  readRepoFile,
  repoPathExists,
  captureScreenshots: (dir, baseUrl) => captureDocScreenshots(dir, baseUrl),
  runTestGate: (dir, stack) => runTestGate(dir, stack),
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

  // Where the work happens, and on which branch it lands — the target repo's
  // devops.md decides that, not this worker (req-020). A repo that cannot be
  // prepared produces an 'error' naming the repo and the reason, so the pass
  // that finds nothing to do afterwards is never silent about why.
  let dir: string;
  let branch: string;
  try {
    const prepared = await d.prepareRepo(repo.url, token);
    dir = prepared.dir;
    branch = prepared.branch;
  } catch (err) {
    return {
      kind: "error",
      message: `${PREPARE_FAILED_MESSAGE} (${repo.name}): ${String(err)}`,
      md: runMd(),
    };
  }

  /** Commit and push onto the branch this repo works on (req-020). */
  const push = (message: string) =>
    d.commitAndPush(dir, message, token, { branch });

  /**
   * The 'error' a push that did not happen becomes (req-020). "Nothing to
   * commit" is not one of those — that is a run that had nothing to say.
   */
  const pushError = (
    result: { pushed: boolean; detail: string },
    note = "",
  ): StepDecision => ({
    kind: "error",
    message: `${PUSH_FAILED_MESSAGE} (${repo.name}): ${result.detail}${note}`,
    md: runMd(),
  });

  // The Doku task stands or falls with the repo's design template (req-016):
  // without one it does NOTHING — no Claude run, no file, no commit — and the
  // Verlauf says why. Checked before anything else happens, so a repo that has
  // not been set up yet costs a clone and not an hour of Claude.
  let designDir: string | null = null;
  /** What this run photographed; stays empty for every type but Doku (req-017). */
  let shots: ShotResult = { shot: [], missing: [] };
  if (src.kind === "doc") {
    designDir = await docDesignDir(d, dir);
    if (!designDir) {
      return { kind: "success", message: NO_DESIGN_MESSAGE, md: runMd() };
    }
    // Pictures first, prompt second: Claude can only place images that are
    // already lying in the working copy (req-017). Where the app runs comes out
    // of the repo's own devops.md — screenshots are taken against dev, never
    // against prod and never against a locally started app.
    const devops = await d.readRepoFile(dir, DEVOPS_FILE).catch(() => null);
    shots = await d
      .captureScreenshots(dir, devUrlFrom(devops))
      .catch((err): ShotResult => ({
        shot: [],
        missing: [{ page: "/", reason: `Screenshot-Lauf abgebrochen: ${String(err)}` }],
      }));
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
        message: `${PHASE_FILE_MOVE}: ${md} konnte nicht nach in-progress verschoben werden: ${String(err)}`,
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
      screenshots: shots.shot,
    });
  } else {
    prompt = recurringPrompt(taskType.label);
  }

  // Live output: the tail arrives while Claude runs, so the status writes are
  // queued instead of awaited (a slow write must not stall the process). The
  // queue is drained before each run returns, so nothing is still in flight when
  // the loop clears the running status. Wrapped in one helper because a step can
  // start Claude twice: once for the work, once to repair a red suite (req-019).
  let outputWrites: Promise<void> = Promise.resolve();
  const claude = async (text: string) => {
    const res = await d.runClaude(dir, text, {
      onOutput: (tail) => {
        outputWrites = outputWrites
          .then(() => d.setCurrentOutput(tail))
          .catch(() => {});
      },
    });
    await outputWrites;
    return res;
  };
  const outcome = await claude(prompt);

  if (!outcome.ok) {
    // A rate/usage limit is NOT a failure (req-029): the requirement is fine,
    // the account is just throttled. Do NOT park to failed/ — discard the
    // half-done work so the next attempt starts clean (bug-002), leave the .md
    // in ready/ (the in-progress claim was never committed, so discarding
    // restores it), and tell the loop to pause until the limit resets.
    if (isRateLimit(outcome.summary)) {
      await d.discardChanges(dir).catch(() => {});
      return {
        kind: "rate-limited",
        message: `Rate-Limit: ${outcome.summary}`,
        pauseUntil: pauseUntilFrom(outcome.summary, d.now().getTime()),
        md: runMd(),
      };
    }
    // Park the .md under failed/ and push that move (file-driven only), so the
    // same task is not picked up again on the next pass (bug-002).
    const parked =
      src.base && mdName
        ? await parkFailed(d, dir, src.base, mdName, token, branch)
        : "";
    return {
      kind: "error",
      message: `${PHASE_CLAUDE}: ${outcome.summary}${parked}`,
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
    const pushed = await push(`worker: neue Idee ${created.join(", ")}`);
    if (pushFailed(pushed)) return pushError(pushed);
    return {
      kind: "success",
      message: `Neue Idee: ${created.join(", ")} — ${pushed.detail}`,
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
    const pushed = await push(`worker: ${taskType.label}-Bericht abgelegt`);
    const where = rel ? ` (Bericht: ${rel})` : "";
    if (pushFailed(pushed)) return pushError(pushed, where);
    return {
      kind: "success",
      message: `${outcome.summary} — ${pushed.detail}${where}`,
      md: runMd(),
    };
  }

  // The Doku task's result IS the site (req-016): whatever the run left under
  // site/user-docs/ gets committed and pushed, which is what triggers the dev
  // deploy. It files no report — the pages are the report. A run that found
  // nothing to add changes nothing, and that is a normal day, not a failure.
  if (src.kind === "doc") {
    // Whatever happened to the pictures belongs in the Verlauf of THIS run, so a
    // page that stayed without one is visible instead of silently absent
    // (req-017) — no matter whether the run changed anything else.
    const note = screenshotNote(shots);
    const pushed = await push("worker: Doku aktualisiert");
    if (pushFailed(pushed)) return pushError(pushed, note ? ` (${note})` : "");
    if (pushed.detail === NO_CHANGES_DETAIL) {
      return {
        kind: "success",
        message: `${DOC_UNCHANGED_MESSAGE}${note ? ` (${note})` : ""}`,
        md: runMd(),
      };
    }
    return {
      kind: "success",
      message: `${outcome.summary} — ${pushed.detail} (Doku: ${USER_DOCS_DIR}${
        note ? `, ${note}` : ""
      })`,
      md: runMd(),
    };
  }

  // The test gate (req-019). A file-driven requirement is finished when the
  // repo's FULL test suite is green — never because the change looked like pure
  // text or documentation, because that judgement is exactly what let a red
  // suite into done/ last time. So the gate sits here, in front of the move to
  // done/ and in front of the commit, and it runs for every file-driven step.
  //
  // Red gets one repair attempt in the same run. What is still red afterwards is
  // NOT finished: its .md is parked under failed/ (same mechanics as a failed
  // Claude run, bug-002) and the Verlauf carries the cause.
  let gateNote = "";
  if (src.kind === "file" && src.base && mdRel && mdName) {
    const stack = await d.readRepoFile(dir, STACK_FILE).catch(() => null);
    let gate = await testGate(d, dir, stack);
    if (gate.status === "red") {
      const fix = await claude(testFixPrompt(mdRel, gate.reason));
      gate = fix.ok
        ? await testGate(d, dir, stack)
        : {
            ...gate,
            reason: `${gate.reason} — Reparaturversuch fehlgeschlagen: ${fix.summary}`,
          };
    }
    if (gate.status === "red") {
      const parked = await parkFailed(d, dir, src.base, mdName, token, branch);
      return {
        kind: "error",
        message: `${GATE_RED_MESSAGE}: ${gate.reason}${parked}`,
        md: runMd(),
      };
    }
    gateNote = testGateNote(gate);
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
  const pushed = await push(commitMsg);

  // The log stays a short message; it only names the file so the full report
  // remains findable from the Verlauf (req-010).
  const note = reportRel ? ` (Bericht: ${reportRel})` : "";
  // A push that did not happen is a failed step (req-020). The .md is NOT
  // parked under failed/: the work itself was fine and nothing was committed,
  // so the next prepareRepo puts it back into ready/ and the next pass retries
  // it — parking it would punish the repo for a network that was down.
  if (pushFailed(pushed)) return pushError(pushed, `${gateNote}${note}`);
  return {
    kind: "success",
    message: `${outcome.summary} — ${pushed.detail}${gateNote}${note}`,
    md: runMd(),
  };
}

/**
 * Did this push fail (req-020)? A working copy that held nothing to commit did
 * not fail — a run can legitimately change nothing, and calling that an error
 * would turn every quiet Doku day into a red entry.
 */
function pushFailed(result: { pushed: boolean; detail: string }): boolean {
  return !result.pushed && result.detail !== NO_CHANGES_DETAIL;
}

/**
 * The test gate as the step sees it (req-019): the dep's answer, or a red gate
 * when asking itself blew up. "We could not check" must never end up reading
 * like "it passed" — that is the whole point of the gate.
 */
async function testGate(
  d: ExecuteDeps,
  dir: string,
  stack: string | null,
): Promise<TestGateResult> {
  return d.runTestGate(dir, stack).catch(
    (err: unknown): TestGateResult => ({
      status: "red",
      command: null,
      reason: `Test-Lauf abgebrochen: ${String(err)}`,
    }),
  );
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
  branch: string,
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
      { branch },
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
