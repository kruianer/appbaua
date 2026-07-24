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
  return {
    phase: derivePhase(enabled, status, now),
    currentRepo: status.currentRepo,
    currentType: status.currentType,
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
