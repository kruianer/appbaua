// Domain type + retention constants for the worker run log (req-004).

export type RunStatus = "success" | "error" | "idle";

export type RunLogEntry = {
  id: number;
  startedAt: string; // ISO
  endedAt: string; // ISO
  repo: string | null; // display name; null for idle rows
  taskType: string | null; // label; null for idle rows
  status: RunStatus;
  message: string;
};

/** A row about to be written (no id yet). */
export type NewRunLogEntry = Omit<RunLogEntry, "id">;

export const LOG_MAX_ROWS = 1_000_000;
export const LOG_MAX_AGE_DAYS = 365;
export const LOG_PAGE_SIZE = 50;
