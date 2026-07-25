import type { RunLogEntry } from "./run-log";

// Pure logic for req-006: how a task type maps to work in a target repo.
// File-driven types read the oldest .md from a ready/ folder; recurring types
// run at most once per calendar day per repo. Kept I/O-free for testing.
//
// req-011 adds the third shape, "idea": like a recurring type it runs at most
// once per repo and calendar day, but its result is neither code nor a review
// report — it is one new idea file in delivery/idea/ of the target repo.

export type TaskKind = "file" | "recurring" | "idea";

export type TaskTypeSource = {
  /**
   * ready/in-progress/done/failed base under the repo, e.g.
   * "delivery/requirements". For the idea type it is the folder the ideas
   * themselves live in (req-011).
   */
  base: string | null;
  kind: TaskKind;
};

/** Where the ideas of a repo live: open ones here, implemented ones in done/. */
export const IDEA_DIR = "delivery/idea";
/**
 * The repo's optional steer for new ideas (req-011). The user maintains it; the
 * worker only reads it, and proposes freely when it is missing.
 */
export const IDEA_DIRECTION_FILE = "delivery/idea-direction.md";

// Maps the predefined task-type ids (req-002) to their source in a repo.
export const TASK_SOURCES: Record<string, TaskTypeSource> = {
  bug: { base: "delivery/bugs", kind: "file" },
  requirement: { base: "delivery/requirements", kind: "file" },
  "code-review": { base: null, kind: "recurring" },
  doku: { base: null, kind: "recurring" },
  ideen: { base: IDEA_DIR, kind: "idea" },
  // security-review may be added as a type later; treated as recurring.
  "security-review": { base: null, kind: "recurring" },
};

export function sourceFor(taskId: string): TaskTypeSource {
  return TASK_SOURCES[taskId] ?? { base: null, kind: "recurring" };
}

/**
 * Does this type run at most once per repo and calendar day? Everything that is
 * not driven by a queue of .md files does — there is no work item that would
 * tell it apart from the run it already did today (req-006, req-011).
 */
export function runsOncePerDay(src: TaskTypeSource): boolean {
  return src.kind !== "file";
}

export function readyDir(base: string): string {
  return `${base}/ready`;
}
/** Where a .md lives while it is actually being worked on (req-008). */
export function inProgressDir(base: string): string {
  return `${base}/in-progress`;
}
/**
 * Where finished work lands: a worked-off .md for a file-driven type, an
 * implemented idea for the idea type (req-011).
 */
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
 * The .md files present in `after` but not in `before` (req-011). This is how a
 * step tells "Claude proposed an idea" from "Claude found nothing new": the
 * proposal is a file it wrote, not a sentence it said. Non-.md entries (the
 * done/ folder, .gitkeep) are ignored; the result is sorted for a stable
 * message.
 */
export function newMdFiles(before: string[], after: string[]): string[] {
  const known = new Set(before);
  return after
    .filter((f) => f.toLowerCase().endsWith(".md") && !known.has(f))
    .sort();
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
