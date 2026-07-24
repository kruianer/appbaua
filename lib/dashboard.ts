import type { Repo } from "./repos";
import type { TaskType } from "./task-types";
import type { WorkerStatus } from "./worker-status";
import type { RunLogEntry } from "./run-log";
import { isTaskDue } from "./scheduling";

// Pure derivation of the start-page status + dashboard (req-005). Kept free of
// I/O so it is fully unit-testable; the API route feeds it the loaded data.

export type WorkerPhase = "running" | "pause" | "idle" | "stopped";

export type DashboardData = {
  phase: WorkerPhase;
  // running:
  currentRepo: string | null;
  currentType: string | null;
  /** .md the running step works on; null for recurring types (req-008). */
  currentMd: string | null;
  /** Live Claude output tail of the running step; null unless running (req-008). */
  currentOutput: string | null;
  stepStartedAt: string | null;
  // pause:
  pauseUntil: string | null;
  // tiles:
  today: { done: number; errors: number };
  activeRepos: number;
  totalRepos: number;
  dueTypes: number;
  lastError: { at: string; message: string } | null;
};

/** Local start-of-today (00:00) as ISO, from a given "now". */
export function startOfTodayIso(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  return d.toISOString();
}

/**
 * Derive the display phase. "stopped" wins when the switch is off. Otherwise a
 * running step wins; else a pause window that is still in the future; else idle.
 */
export function derivePhase(
  enabled: boolean,
  status: WorkerStatus,
  now: Date,
): WorkerPhase {
  if (!enabled) return "stopped";
  if (status.currentRepo && status.currentType) return "running";
  if (status.pauseUntil && new Date(status.pauseUntil).getTime() > now.getTime()) {
    return "pause";
  }
  return "idle";
}

export function buildDashboard(input: {
  enabled: boolean;
  status: WorkerStatus;
  repos: Repo[];
  taskTypes: TaskType[];
  today: { done: number; errors: number };
  lastError: RunLogEntry | null;
  now: Date;
}): DashboardData {
  const { enabled, status, repos, taskTypes, today, lastError, now } = input;
  const phase = derivePhase(enabled, status, now);
  // The md name and the live output belong to the running step only: once it is
  // over, the Aktivität tab must not show them any more (req-008) — even if a
  // late write left something behind in the status row.
  const running = phase === "running";
  return {
    phase,
    currentRepo: status.currentRepo,
    currentType: status.currentType,
    currentMd: running ? status.currentMd : null,
    currentOutput: running ? status.currentOutput : null,
    stepStartedAt: status.stepStartedAt,
    pauseUntil: status.pauseUntil,
    today,
    activeRepos: repos.filter((r) => r.active).length,
    totalRepos: repos.length,
    // Tiles reflect the config regardless of the switch (req-005).
    dueTypes: taskTypes.filter((t) => isTaskDue(t, now)).length,
    lastError: lastError
      ? { at: lastError.endedAt, message: lastError.message }
      : null,
  };
}
