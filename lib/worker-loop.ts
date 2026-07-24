import { listRepos } from "./repo-service";
import { listTaskTypes } from "./task-service";
import { getWorkerState } from "./worker-state";
import { getRunLogStore } from "./run-log-store";
import { planRun, isTaskDue } from "./scheduling";
import {
  clearRunningStep,
  setPauseUntil,
  setRunningStep,
} from "./worker-status";

// The simulated worker loop (req-004). Runs server-side, independent of any
// browser. Each step waits STEP_MS and logs success/error; ~1 in ERROR_EVERY
// steps is a simulated error. An empty run logs one "idle" row and waits
// EMPTY_PAUSE_MS. It also writes its live status (running step / pause window,
// req-005) so the start page can show what it is doing right now. Deps (sleep,
// now, shouldFail, and the status mutators) are injectable for tests.

export const STEP_MS = 15_000;
export const EMPTY_PAUSE_MS = 5 * 60_000;
export const ERROR_EVERY = 10;

export type LoopDeps = {
  sleep: (ms: number) => Promise<void>;
  now: () => Date;
  /** Given the global step counter, decide if this step is a simulated error. */
  shouldFail: (stepIndex: number) => boolean;
  setRunningStep: (repo: string, taskType: string, startedAt: string) => Promise<void>;
  clearRunningStep: () => Promise<void>;
  setPauseUntil: (iso: string | null) => Promise<void>;
};

const defaultDeps: LoopDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  shouldFail: (stepIndex) => stepIndex % ERROR_EVERY === ERROR_EVERY - 1,
  setRunningStep,
  clearRunningStep,
  setPauseUntil,
};

/**
 * Run exactly one pass over the current config. Returns how many steps were
 * executed. Re-checks worker-state and per-step due-ness live, so config
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

  if (steps.length === 0) {
    const at = deps.now().toISOString();
    await deps.clearRunningStep();
    await log.append({
      startedAt: at,
      endedAt: at,
      repo: null,
      taskType: null,
      status: "idle",
      message: "nichts zu tun gefunden",
    });
    return 0;
  }

  let done = 0;
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
    await deps.sleep(STEP_MS);
    const endedAt = deps.now().toISOString();

    const failed = deps.shouldFail(stepCounter.n);
    stepCounter.n += 1;

    await log.append({
      startedAt,
      endedAt,
      repo: step.repo.name,
      taskType: step.taskType.label,
      status: failed ? "error" : "success",
      message: failed
        ? "Simuliert: Schritt fehlgeschlagen"
        : "Simuliert: 15s Pause, Erfolg",
    });
    done += 1;
  }
  await deps.clearRunningStep(); // no step running after the pass
  return done;
}

/** Endless loop. After an empty pass, wait EMPTY_PAUSE_MS before looking again. */
export async function runForever(deps: LoopDeps = defaultDeps): Promise<void> {
  const stepCounter = { n: 0 };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const done = await runOnce(stepCounter, deps);
    if (done === 0) {
      // Record the pause window so the start page can show "Pause bis HH:MM".
      const until = new Date(deps.now().getTime() + EMPTY_PAUSE_MS).toISOString();
      await deps.setPauseUntil(until);
      await deps.sleep(EMPTY_PAUSE_MS);
      await deps.setPauseUntil(null);
    }
  }
}
