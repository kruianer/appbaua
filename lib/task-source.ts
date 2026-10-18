import type { RunLogEntry } from "./run-log";

// Pure logic for req-006: how a task type maps to work in a target repo.
// File-driven types read the oldest .md from a ready/ folder; recurring types
// run at most once per calendar day per repo. Kept I/O-free for testing.
//
// req-011 adds the third shape, "idea": like a recurring type it runs at most
// once per repo and calendar day, but its result is neither code nor a review
// report — it is one new idea file in delivery/idea/ of the target repo.

// req-014 adds the fourth shape, "security": once per repo and calendar day
// like the recurring types, but it files its report only when the check found
// something — and it never changes code.
//
// req-016 adds the fifth shape, "doc": once per repo and calendar day as well,
// but its result is a multi-page user documentation under site/user-docs/ — and
// it only runs at all when the repo points it at a design template.

// req-043 adds the sixth shape, "feedback": a queue like the file-driven types
// (ready/in-progress/done/failed, oldest first), but Claude decides on its own
// what — if anything — the feedback becomes, and it never touches app code; see
// FEEDBACK_KINDS below for where that decision is shared with "file".

// req-047 adds the seventh shape, "self-assign": once per repo and calendar
// day like the idea type, but its result is a brand-new Requirement filed
// straight into the repo's OWN delivery/requirements/ready/ — the same place
// a human-written one lands. Whether it ran is read off that folder, the same
// trick the idea task uses. Unlike every other type it also needs a switch
// PER REPO (see Repo.selfAssign in repos.ts), because running everywhere by
// accident is exactly what it must not do; that extra gate lives in
// scheduling.ts (planRun), not here.

export type TaskKind =
  | "file"
  | "recurring"
  | "idea"
  | "security"
  | "doc"
  | "feedback"
  | "self-assign";

/**
 * The kinds that claim a .md from a ready/ queue (requeue stale claims, pick
 * the oldest, move it through in-progress/ to done/ or failed/). "file" works
 * the .md itself (code changes, test gate); "feedback" only reads it and
 * decides — but both share the same queue mechanics (req-043).
 */
export const QUEUE_DRIVEN_KINDS: TaskKind[] = ["file", "feedback"];

export function isQueueDriven(kind: TaskKind): boolean {
  return QUEUE_DRIVEN_KINDS.includes(kind);
}

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

/** Base folder for Requirements — same one "requirement" (req-006) works off. */
export const REQUIREMENTS_DIR = "delivery/requirements";

/**
 * Where a self-assigned Requirement lands (req-047): the exact folder a
 * human-written one is placed in, not a queue of its own — a self-assignment
 * IS a new ready/ requirement, nothing more.
 */
export const SELF_ASSIGN_DIR = readyDir(REQUIREMENTS_DIR);

// Maps the predefined task-type ids (req-002) to their source in a repo.
export const TASK_SOURCES: Record<string, TaskTypeSource> = {
  bug: { base: "delivery/bugs", kind: "file" },
  requirement: { base: REQUIREMENTS_DIR, kind: "file" },
  "code-review": { base: null, kind: "recurring" },
  // No work-item folder either: the Doku task writes the site itself into
  // USER_DOCS_DIR, and there is no ready/done queue in front of it (req-016).
  doku: { base: null, kind: "doc" },
  ideen: { base: IDEA_DIR, kind: "idea" },
  // No work-item folder: the Security task reads the repo and writes at most a
  // report into SECURITY_REPORT_DIR (req-014).
  security: { base: null, kind: "security" },
  // Queue like bug/requirement, but Claude only reads and decides (req-043).
  feedback: { base: "delivery/feedback", kind: "feedback" },
  // base IS the folder the new .md goes into, same pattern as "ideen" (req-047).
  selbstauftrag: { base: SELF_ASSIGN_DIR, kind: "self-assign" },
};

export function sourceFor(taskId: string): TaskTypeSource {
  return TASK_SOURCES[taskId] ?? { base: null, kind: "recurring" };
}

/**
 * Does this type run at most once per repo and calendar day? Everything that is
 * not driven by a queue of .md files does — there is no work item that would
 * tell it apart from the run it already did today (req-006, req-011, req-014,
 * req-016). Feedback has such a queue too (req-043), so it is exempt the same
 * way "file" is.
 */
export function runsOncePerDay(src: TaskTypeSource): boolean {
  return !isQueueDriven(src.kind);
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
 * All .md files, oldest first by filename (mtime is unreliable after a
 * clone, so we order by name — requirement/bug files are prefixed req-NNN /
 * bug-NNN, which sorts oldest-first).
 */
export function sortedMds(files: string[]): string[] {
  return files.filter((f) => f.toLowerCase().endsWith(".md")).sort();
}

/** The single oldest .md by filename (see sortedMds), or null if none wait. */
export function oldestMd(files: string[]): string | null {
  const mds = sortedMds(files);
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
