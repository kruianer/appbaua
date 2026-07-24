import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { RunLogEntry } from "./run-log";
import {
  doneDir,
  failedDir,
  inProgressDir,
  oldestMd,
  ranTodayForRepo,
  readyDir,
  sourceFor,
} from "./task-source";
import {
  commitAndPush,
  listReady,
  moveMd,
  prepareRepo,
} from "./workspace";
import {
  fileTaskPrompt,
  recurringPrompt,
  runClaude,
} from "./claude-runner";
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

  // Recurring types: skip if already ran today for this repo.
  if (src.kind === "recurring") {
    if (ranTodayForRepo(recentLog, repo.name, taskType.label, d.now())) {
      return { kind: "skip" };
    }
  }

  let dir: string;
  try {
    dir = await d.prepareRepo(repo.url, d.token);
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

  const prompt =
    src.kind === "file" && mdRel
      ? fileTaskPrompt(mdRel)
      : recurringPrompt(taskType.label);

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
    // Move the .md to failed/ (file-driven only), nothing pushed.
    if (src.base && mdRel && mdName) {
      try {
        await d.moveMd(dir, mdRel, `${failedDir(src.base)}/${mdName}`);
      } catch {
        /* best effort */
      }
    }
    return { kind: "error", message: outcome.summary };
  }

  // Success: for file-driven, move in-progress -> done before committing.
  if (src.base && mdRel && mdName) {
    try {
      await d.moveMd(dir, mdRel, `${doneDir(src.base)}/${mdName}`);
    } catch {
      /* best effort */
    }
  }

  const commitMsg = mdName
    ? `worker: ${mdName} abgearbeitet`
    : `worker: ${taskType.label} durchgeführt`;
  const push = await d.commitAndPush(dir, commitMsg);

  return {
    kind: "success",
    message: `${outcome.summary} — ${push.detail}`,
  };
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
