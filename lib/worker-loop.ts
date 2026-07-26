import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { RunLogEntry } from "./run-log";
import { listRepos } from "./repo-service";
import { listTaskTypes } from "./task-service";
import { getWorkerState } from "./worker-state";
import { getRunLogStore } from "./run-log-store";
import { planRun, isTaskDue } from "./scheduling";
import { executeStep, type StepDecision } from "./execute-step";
import { redact } from "./redact";
import {
  clearRunningStep,
  setPauseUntil,
  setRunningStep,
} from "./worker-status";

// The worker loop. Runs server-side, independent of any browser. Each step
// executes real work via Claude Code (req-006, executeStep): skip / success /
// error. An empty run logs one "idle" row. A pass that got nothing done —
// nothing to do, or every step failed — waits EMPTY_PAUSE_MS before looking
// again (bug-002). It also writes its live status (running step / pause window,
// req-005) so the start page can show what it is doing right now. Deps
// (runStep, now, status mutators, sleep) are injectable for tests.
//
// req-020 closes the one hole in that account: a pass that PLANNED steps and
// then skipped every one of them wrote nothing at all and went to sleep, so a
// repo whose work the worker never got to looked exactly like a worker with
// nothing to do. The "idle" row is therefore no longer tied to an empty plan
// but to an empty RESULT — every pause is preceded by a line saying why.

export const EMPTY_PAUSE_MS = 5 * 60_000;

export type LoopDeps = {
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** Execute one real step (req-006). Returns skip/success/error. */
  runStep: (
    repo: Repo,
    taskType: TaskType,
    recentLog: RunLogEntry[],
  ) => Promise<StepDecision>;
  setRunningStep: (repo: string, taskType: string, startedAt: string) => Promise<void>;
  clearRunningStep: () => Promise<void>;
  setPauseUntil: (iso: string | null) => Promise<void>;
};

const defaultDeps: LoopDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  runStep: (repo, taskType, recentLog) =>
    executeStep(repo, taskType, recentLog),
  setRunningStep,
  clearRunningStep,
  setPauseUntil,
};

/**
 * Run exactly one pass over the current config. Returns how many steps actually
 * got work done, i.e. succeeded — a failed step is logged but does not count
 * as progress, so a permanently failing task cannot keep the loop from pausing
 * (bug-002). Re-checks worker-state and per-step due-ness live, so config
 * changes take effect within the pass. `stepCounter` is a mutable ref shared
 * across passes so the 1-in-10 error cadence is stable over time.
 */
export async function runOnce(
  stepCounter: { n: number },
  deps: LoopDeps = defaultDeps,
): Promise<number> {
  const state = await getWorkerState();
  if (!state.enabled) return 0; // switch off: do nothing, log nothing

  const repos = await listRepos();
  const taskTypes = await listTaskTypes();
  const steps = planRun(repos, taskTypes, deps.now());
  const log = getRunLogStore();

  let succeeded = 0;
  /** How many rows this pass wrote — what decides whether it stayed silent. */
  let logged = 0;
  for (const step of steps) {
    // Stop if the switch was flipped off mid-run (after finishing current step
    // is handled by the loop; here we simply stop starting new steps).
    const live = await getWorkerState();
    if (!live.enabled) break;

    // Re-check due-ness live, so a repo deactivated or a window that ended
    // mid-run causes the step to be skipped.
    const freshRepos = await listRepos();
    const freshTypes = await listTaskTypes();
    const repoActive = freshRepos.some(
      (r) => r.id === step.repo.id && r.active,
    );
    const typeNow = freshTypes.find((t) => t.id === step.taskType.id);
    if (!repoActive || !typeNow || !isTaskDue(typeNow, deps.now())) {
      continue;
    }

    const startedAt = deps.now().toISOString();
    await deps.setRunningStep(step.repo.name, step.taskType.label, startedAt);
    stepCounter.n += 1;

    // A step must never crash the whole loop or leave the status stuck on
    // "running": any thrown error becomes a logged "error" entry, and the
    // running step is always cleared afterwards.
    let decision: StepDecision;
    try {
      const recent = await log.list(0, 500);
      decision = await deps.runStep(step.repo, step.taskType, recent);
    } catch (err) {
      decision = { kind: "error", message: `Schritt abgebrochen: ${String(err)}` };
    } finally {
      await deps.clearRunningStep();
    }
    const endedAt = deps.now().toISOString();

    if (decision.kind === "skip") {
      // Nothing to do for this repo x type (e.g. empty ready/, or already ran
      // today): no log entry, does not count as work done.
      continue;
    }

    await log.append({
      startedAt,
      endedAt,
      repo: step.repo.name,
      taskType: step.taskType.label,
      status: decision.kind === "success" ? "success" : "error",
      // Last stop before the message becomes a durable, UI-visible log row: no
      // credential gets past here, whichever tool put one into it (bug-003).
      message: redact(decision.message),
      // The .md the step worked off, so the Verlauf can name it (req-015).
      md: decision.md ?? null,
    });
    logged += 1;
    // Only success is progress. Counting errors here would keep the loop from
    // ever pausing while a step fails on every single pass (bug-002).
    if (decision.kind === "success") succeeded += 1;
  }
  await deps.clearRunningStep(); // no step running after the pass

  // A pass that wrote nothing is about to pause, and a pause nobody can explain
  // is what req-020 is about: say so once. This covers both ways a pass can end
  // up empty — nothing was due at all, and every step that was due had nothing
  // to do.
  if (logged === 0) {
    const at = deps.now().toISOString();
    await log.append({
      startedAt: at,
      endedAt: at,
      repo: null,
      taskType: null,
      status: "idle",
      message: "nichts zu tun gefunden",
      md: null, // no step ran, so there is no file to name (req-015)
    });
  }
  return succeeded;
}

/**
 * Endless loop. After a pass that got nothing done — nothing was due, or every
 * step failed — wait EMPTY_PAUSE_MS before looking again (bug-002).
 */
export async function runForever(deps: LoopDeps = defaultDeps): Promise<void> {
  const stepCounter = { n: 0 };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let succeeded = 0;
    try {
      succeeded = await runOnce(stepCounter, deps);
    } catch (err) {
      // A whole pass failed unexpectedly: never let the loop die. Clear any
      // stuck running status and pause before trying again.
      // eslint-disable-next-line no-console
      console.error("[worker] pass failed:", err);
      try {
        await deps.clearRunningStep();
      } catch {
        /* ignore */
      }
    }
    if (succeeded === 0) {
      // Record the pause window so the start page can show "Pause bis HH:MM".
      const until = new Date(deps.now().getTime() + EMPTY_PAUSE_MS).toISOString();
      await deps.setPauseUntil(until);
      await deps.sleep(EMPTY_PAUSE_MS);
      await deps.setPauseUntil(null);
    }
  }
}
