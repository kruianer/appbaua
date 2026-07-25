import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { RunLogEntry } from "./run-log";
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
  commitAndPush,
  discardChanges,
  headCommit,
  listReady,
  moveMd,
  prepareRepo,
  writeRepoFile,
} from "./workspace";
import {
  NO_IDEA_MESSAGE,
  fileTaskPrompt,
  ideaPrompt,
  recurringPrompt,
  runClaude,
} from "./claude-runner";
import { reportContent, reportPath } from "./review-report";
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

export type StepDecision =
  | { kind: "skip" }
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

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

  if (!d.token) {
    return { kind: "error", message: "Kein GitHub-Token für Push konfiguriert" };
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
    return { kind: "error", message: `Repo vorbereiten fehlgeschlagen: ${String(err)}` };
  }

  // Pick the work item and claim it by moving it into in-progress/ (req-008).
  let mdName: string | null = null;
  let mdRel: string | null = null;
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
    return { kind: "error", message: `${outcome.summary}${parked}` };
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
      return { kind: "success", message: NO_IDEA_MESSAGE };
    }
    const push = await d.commitAndPush(
      dir,
      `worker: neue Idee ${created.join(", ")}`,
      token,
    );
    return {
      kind: "success",
      message: `Neue Idee: ${created.join(", ")} — ${push.detail}`,
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
 * Write Claude's full report into delivery/reviews/ of the working copy and
 * return its repo-relative path (req-010). Best effort: a report that cannot be
 * written must not turn a successful review into a failed step — the analysis
 * itself did happen, and the log message then simply names no file.
 */
async function fileReport(
  d: ExecuteDeps,
  dir: string,
  repo: Repo,
  taskType: TaskType,
  report: string,
): Promise<string | null> {
  try {
    const ref = {
      taskId: taskType.id,
      repoName: repo.name,
      commit: await d.headCommit(dir),
      now: d.now(),
    };
    const rel = reportPath(ref);
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
