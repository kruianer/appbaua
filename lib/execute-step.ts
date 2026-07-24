import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { RunLogEntry } from "./run-log";
import {
  doneDir,
  failedDir,
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

// Orchestrates one real execution step (req-006). Returns a decision the loop
// logs. "skip" means no log entry (nothing to do); "success"/"error" produce a
// log entry. Side effects (clone, claude, push, move) go through injectable
// deps so this is unit-testable without git or the CLI.

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
  now: () => Date;
  token: string | undefined;
};

const defaultDeps = (): ExecuteDeps => ({
  prepareRepo,
  listReady,
  runClaude,
  commitAndPush,
  moveMd,
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

  // Pick the work item.
  let mdRel: string | null = null;
  if (src.kind === "file" && src.base) {
    const files = await d.listReady(dir, readyDir(src.base));
    const md = oldestMd(files);
    if (!md) return { kind: "skip" }; // file-driven + empty => silent skip
    mdRel = `${readyDir(src.base)}/${md}`;
  }

  const prompt =
    src.kind === "file" && mdRel
      ? fileTaskPrompt(mdRel)
      : recurringPrompt(taskType.label);

  const outcome = await d.runClaude(dir, prompt);

  if (!outcome.ok) {
    // Move the .md to failed/ (file-driven only), nothing pushed.
    if (src.kind === "file" && src.base && mdRel) {
      const name = mdRel.split("/").pop()!;
      try {
        await d.moveMd(dir, mdRel, `${failedDir(src.base)}/${name}`);
      } catch {
        /* best effort */
      }
    }
    return { kind: "error", message: outcome.summary };
  }

  // Success: for file-driven, move ready -> done before committing.
  if (src.kind === "file" && src.base && mdRel) {
    const name = mdRel.split("/").pop()!;
    try {
      await d.moveMd(dir, mdRel, `${doneDir(src.base)}/${name}`);
    } catch {
      /* best effort */
    }
  }

  const commitMsg =
    src.kind === "file" && mdRel
      ? `worker: ${mdRel} abgearbeitet`
      : `worker: ${taskType.label} durchgeführt`;
  const push = await d.commitAndPush(dir, commitMsg);

  return {
    kind: "success",
    message: `${outcome.summary} — ${push.detail}`,
  };
}
