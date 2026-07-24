import type { RunLogEntry } from "./run-log";

// Pure logic for req-006: how a task type maps to work in a target repo.
// File-driven types read the oldest .md from a ready/ folder; recurring types
// run at most once per calendar day per repo. Kept I/O-free for testing.

export type TaskKind = "file" | "recurring";

export type TaskTypeSource = {
  /**
   * ready/in-progress/done/failed base under the repo, e.g.
   * "delivery/requirements".
   */
  base: string | null;
  kind: TaskKind;
};

// Maps the predefined task-type ids (req-002) to their source in a repo.
export const TASK_SOURCES: Record<string, TaskTypeSource> = {
  bug: { base: "delivery/bugs", kind: "file" },
  requirement: { base: "delivery/requirements", kind: "file" },
  "code-review": { base: null, kind: "recurring" },
  doku: { base: null, kind: "recurring" },
  // security-review may be added as a type later; treated as recurring.
  "security-review": { base: null, kind: "recurring" },
};

export function sourceFor(taskId: string): TaskTypeSource {
  return TASK_SOURCES[taskId] ?? { base: null, kind: "recurring" };
}

export function readyDir(base: string): string {
  return `${base}/ready`;
}
/** Where a .md lives while it is actually being worked on (req-008). */
export function inProgressDir(base: string): string {
  return `${base}/in-progress`;
}
export function doneDir(base: string): string {
  return `${base}/done`;
}
export function failedDir(base: string): string {
  return `${base}/failed`;
}

/**
 * Choose the oldest .md by filename (mtime is unreliable after a clone, so we
 * order by name — requirement/bug files are prefixed req-NNN / bug-NNN, which
 * sorts oldest-first). Returns the filename or null.
 */
export function oldestMd(files: string[]): string | null {
  const mds = files.filter((f) => f.toLowerCase().endsWith(".md")).sort();
  return mds.length ? mds[0] : null;
}

/**
 * Has a recurring type already run successfully today for this repo? Derived
 * from the run log: a 'success' entry with matching repo+taskType whose
 * startedAt is on the same local calendar day as `now`.
 */
export function ranTodayForRepo(
  entries: RunLogEntry[],
  repoName: string,
  taskLabel: string,
  now: Date,
): boolean {
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  return entries.some((e) => {
    if (e.status !== "success") return false;
    if (e.repo !== repoName || e.taskType !== taskLabel) return false;
    const t = new Date(e.startedAt);
    return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d;
  });
}
