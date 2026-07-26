import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { RunLogEntry } from "./run-log";
import { listRepos } from "./repo-service";
import { listTaskTypes } from "./task-service";
import { getWorkerState } from "./worker-state";
import { getRunLogStore, isIdleSummary } from "./run-log-store";
import { planRun, isTaskDue } from "./scheduling";
import { executeStep, type StepDecision } from "./execute-step";
import { redact } from "./redact";
import {
  clearRunningStep,
  setPauseUntil,
  setRunningStep,
} from "./worker-status";
import { buildPreview } from "./preview";
import { getPreviewStore } from "./preview-store";

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

/** Prefix the pause status carries when the wait is a rate limit (req-029). */
export const RATE_LIMIT_PAUSE_PREFIX = "Pause wegen Rate-Limit bis";

/**
 * Outcome of one pass. `succeeded` counts steps that got work done (bug-002).
 * `rateLimitUntil` (epoch ms) is set only when a step hit a rate limit and the
 * loop should wait until then instead of the usual empty pause (req-029).
 */
export type PassResult = { succeeded: number; rateLimitUntil?: number };

/** "DD.MM. HH:MM" for the idle-summary message (req-021). */
function stampDe(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The single idle-summary line (req-021): shows since when there has been
 * nothing to do and when it was last checked. When start and last check are the
 * same first pass, it reads as a plain "nichts zu tun".
 */
export function idleSummaryMessage(sinceIso: string, lastIso: string): string {
  if (sinceIso === lastIso) return `Leerlauf — nichts zu tun (${stampDe(lastIso)})`;
  return `Leerlauf — nichts zu tun seit ${stampDe(sinceIso)} (zuletzt geprüft ${stampDe(lastIso)})`;
}

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
  setPauseUntil: (iso: string | null, reason?: string | null) => Promise<void>;
  /** Rebuild and store "Nächste Aktivitäten" after this pass (req-022). */
  updatePreview: () => Promise<void>;
};

const defaultDeps: LoopDeps = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  now: () => new Date(),
  runStep: (repo, taskType, recentLog) =>
    executeStep(repo, taskType, recentLog),
  setRunningStep,
  clearRunningStep,
  setPauseUntil,
  updatePreview: async () => {
    const token = process.env.GITHUB_TOKEN;
    if (!token) return; // same precondition executeStep has for any real work
    const [repos, taskTypes] = await Promise.all([listRepos(), listTaskTypes()]);
    const rows = await buildPreview(repos, taskTypes, new Date(), token);
    await getPreviewStore().set(rows);
  },
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
): Promise<PassResult> {
  const state = await getWorkerState();
  if (!state.enabled) return { succeeded: 0 }; // switch off: do nothing, log nothing

  const repos = await listRepos();
  const taskTypes = await listTaskTypes();
  const steps = planRun(repos, taskTypes, deps.now());
  const log = getRunLogStore();

  let succeeded = 0;
  /** How many rows this pass wrote — what decides whether it stayed silent. */
  let logged = 0;
  /** Set when a step hit a rate limit (req-029): epoch ms to resume at. */
  let rateLimitUntilMs: number | null = null;
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

    if (decision.kind === "rate-limited") {
      // A rate/usage limit hit (req-029): the .md is untouched in ready/, and
      // every other step this pass would hit the same wall. Record it as its own
      // (non-error) row, then stop the pass and hand the resume time up so the
      // loop pauses until the limit resets — not the usual 5-minute empty pause.
      await log.append({
        startedAt,
        endedAt,
        repo: step.repo.name,
        taskType: step.taskType.label,
        status: "idle", // not "error": nothing failed, we are waiting
        message: redact(decision.message),
        md: decision.md ?? null,
      });
      rateLimitUntilMs = decision.pauseUntil;
      break;
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
  // to do. A rate-limited pass already wrote its own row, so it is not silent.
  //
  // req-021: consecutive idle passes collapse into ONE growing row instead of a
  // new "nichts zu tun" line every 5 minutes. The row keeps the phase's start
  // ("seit …") and moves its "zuletzt geprüft" forward; upsertIdle does the
  // merge, so a real entry in between breaks the summary and the next idle pass
  // starts a fresh one.
  if (logged === 0 && rateLimitUntilMs === null) {
    const at = deps.now().toISOString();
    const [newest] = await log.list(0, 1);
    const since =
      newest && isIdleSummary(newest) ? newest.startedAt : at;
    await log.upsertIdle({
      startedAt: since,
      endedAt: at,
      repo: null,
      taskType: null,
      status: "idle",
      message: idleSummaryMessage(since, at),
      md: null, // no step ran, so there is no file to name (req-015)
    });
  }

  // req-022: refresh "Nächste Aktivitäten" after every pass — a real execution
  // changed what is waiting, and even an idle pass can mean a schedule's window
  // just opened or closed. Skipped during a rate-limit pause: nothing changed
  // that the preview cares about, and it would only add load right when the
  // account is already throttled.
  if (rateLimitUntilMs === null) {
    await deps.updatePreview().catch(() => {
      /* best-effort: a stale preview must never break the pass itself */
    });
  }

  return { succeeded, rateLimitUntil: rateLimitUntilMs ?? undefined };
}

/**
 * Endless loop. After a pass that got nothing done — nothing was due, or every
 * step failed — wait EMPTY_PAUSE_MS before looking again (bug-002).
 */
export async function runForever(deps: LoopDeps = defaultDeps): Promise<void> {
  const stepCounter = { n: 0 };
  // eslint-disable-next-line no-constant-condition
  while (true) {
    let result: PassResult = { succeeded: 0 };
    try {
      result = await runOnce(stepCounter, deps);
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

    if (result.rateLimitUntil !== undefined) {
      // A rate limit was hit (req-029): wait until it resets (not the 5-minute
      // empty pause) and show WHY, so the card reads "Pause wegen Rate-Limit bis
      // HH:MM". The .md is untouched in ready/, so the queue retries after.
      const untilMs = Math.max(result.rateLimitUntil, deps.now().getTime());
      const until = new Date(untilMs).toISOString();
      await deps.setPauseUntil(until, RATE_LIMIT_PAUSE_PREFIX);
      await deps.sleep(untilMs - deps.now().getTime());
      await deps.setPauseUntil(null);
      continue;
    }

    if (result.succeeded === 0) {
      // Record the pause window so the start page can show "Pause bis HH:MM".
      const until = new Date(deps.now().getTime() + EMPTY_PAUSE_MS).toISOString();
      await deps.setPauseUntil(until);
      await deps.sleep(EMPTY_PAUSE_MS);
      await deps.setPauseUntil(null);
    }
  }
}
