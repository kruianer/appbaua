import {
  type DaySchedule,
  type TaskType,
  type Weekday,
  WEEKDAYS,
  isOvernightWindow,
  isWithinWindow,
  toMinutes,
} from "./task-types";
import type { Repo } from "./repos";

// Pure scheduling helpers for the worker loop (req-004). "Now" is passed in so
// this is deterministic and unit-testable.

/** JS getDay() is 0=Sunday..6=Saturday; map to our Mon-first Weekday. */
export function weekdayOf(now: Date): Weekday {
  const map: Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return map[now.getDay()];
}

/** Minutes since midnight for a Date (local time). */
export function minutesOfDay(now: Date): number {
  return now.getHours() * 60 + now.getMinutes();
}

/** The weekday before the given one (Mon-first list, so mon -> sun). */
export function previousWeekday(day: Weekday): Weekday {
  const i = WEEKDAYS.indexOf(day);
  return WEEKDAYS[(i + WEEKDAYS.length - 1) % WEEKDAYS.length];
}

/** Does today's own window cover `nowMin`? An enabled day with no window is all-day. */
function coversNow(ds: DaySchedule | undefined, nowMin: number): boolean {
  if (!ds || !ds.enabled) return false;
  const start = toMinutes(ds.start);
  const end = toMinutes(ds.end);
  if (start === null || end === null) return true; // enabled, no window = all day
  return isWithinWindow(nowMin, start, end);
}

/**
 * Does yesterday's window still run into today? Only a window over midnight
 * (22:00–06:00) does, and only up to its end. An all-day yesterday stops at
 * midnight.
 */
function spillsIntoToday(ds: DaySchedule | undefined, nowMin: number): boolean {
  if (!ds || !ds.enabled) return false;
  const start = toMinutes(ds.start);
  const end = toMinutes(ds.end);
  if (start === null || end === null) return false;
  return isOvernightWindow(start, end) && nowMin <= end;
}

/**
 * Is this task type due to run right now? Inactive => never. always => yes.
 * Otherwise the current weekday must be enabled and (if a window is set) the
 * current time must fall within [start, end]; an enabled day with no window is
 * all-day.
 *
 * A window whose end lies before its start runs over midnight (bug-004): it
 * covers both sides of midnight on its own weekday AND reaches into the
 * following day, so Monday 22:00–06:00 is due on Monday 23:30 and on Tuesday
 * 02:00.
 */
export function isTaskDue(t: TaskType, now: Date): boolean {
  if (!t.active) return false;
  if (t.always) return true;
  const day = weekdayOf(now);
  const nowMin = minutesOfDay(now);
  if (coversNow(t.schedule[day], nowMin)) return true;
  return spillsIntoToday(t.schedule[previousWeekday(day)], nowMin);
}

export type PlannedStep = { repo: Repo; taskType: TaskType };

/**
 * One row of the "Nächste Aktivitäten" preview (req-022): what the worker will
 * do next, in the same order it actually works — repo outer, task type inner
 * (bug-008) — so the preview is a truthful look-ahead, not a separate opinion.
 */
export type PreviewEntry = {
  repo: Repo;
  taskType: TaskType;
  /**
   * "queue": no fixed time — an "always" type's position among the OTHER due
   *   "always" entries (0 = the very next one the worker will do).
   * "at": a scheduled type's next window start.
   */
  due:
    | { kind: "queue"; position: number }
    | { kind: "at"; at: Date };
};

/**
 * The full look-ahead the Aktivität tab shows (req-022): every active repo ×
 * active task type, each with when it is next due. An "always" type not due
 * right now (inactive repo aside) cannot happen — active+always is always due
 * — so every "always" entry gets a queue position; every scheduled type gets
 * either "due now" (position 0, folded into the queue at the front) or its
 * next window start.
 *
 * Recurring types (no file queue) show only their one next run, same as any
 * other type here — there is exactly one row per repo × type regardless of
 * kind, which is what "only the next run" means for this preview.
 */
export function planPreview(
  repos: Repo[],
  taskTypes: TaskType[],
  now: Date,
): PreviewEntry[] {
  const activeRepos = repos.filter((r) => r.active);
  const activeTypes = taskTypes.filter((t) => t.active);

  // Queue position counts every entry that is due right now (whether "always"
  // or a schedule whose window happens to be open), in planRun's own order —
  // repo outer, type inner — so position 0 really is next in line.
  let queueIndex = 0;
  const entries: PreviewEntry[] = [];
  for (const repo of activeRepos) {
    for (const taskType of activeTypes) {
      if (isTaskDue(taskType, now)) {
        entries.push({ repo, taskType, due: { kind: "queue", position: queueIndex } });
        queueIndex += 1;
      } else {
        const at = nextWindowStart(taskType, now);
        entries.push({
          repo,
          taskType,
          // at is never null here: inactive/always were excluded/handled above.
          due: { kind: "at", at: at as Date },
        });
      }
    }
  }
  return entries;
}

/**
 * When a scheduled task type next becomes due, as a Date (req-022 preview).
 * Null for "always" (there is no next window — see `queuePosition` for those)
 * and for a type that is due right now (the preview calls that "als nächstes").
 * Searches up to 8 days ahead — enough for any weekly schedule, including one
 * whose only enabled day is the same weekday next week.
 */
export function nextWindowStart(t: TaskType, now: Date): Date | null {
  if (!t.active || t.always) return null;
  if (isTaskDue(t, now)) return null; // due right now, not "next"

  for (let dayOffset = 0; dayOffset <= 8; dayOffset++) {
    const day = new Date(now);
    day.setDate(day.getDate() + dayOffset);
    const weekday = weekdayOf(day);
    const ds = t.schedule[weekday];
    if (!ds?.enabled) continue;
    const start = toMinutes(ds.start);
    // both-null = all day: due from local midnight of that day.
    const startMin = start ?? 0;
    const candidate = new Date(
      day.getFullYear(),
      day.getMonth(),
      day.getDate(),
      Math.floor(startMin / 60),
      startMin % 60,
      0,
      0,
    );
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

/**
 * Build the ordered list of steps for one run: repo priority is the OUTER loop,
 * task-type priority the INNER loop (bug-008). The worker works repo 1
 * completely (all its due task types in priority order) before it moves to repo
 * 2 — the repo list is the primary priority, per the vision ("Repo 1 vor Repo 2
 * vor Repo 3"). Only active repos and active+due task types are included.
 * `repos` and `taskTypes` are already in priority order (index 0 = highest).
 */
export function planRun(
  repos: Repo[],
  taskTypes: TaskType[],
  now: Date,
): PlannedStep[] {
  const activeRepos = repos.filter((r) => r.active);
  const dueTypes = taskTypes.filter((t) => isTaskDue(t, now));
  const steps: PlannedStep[] = [];
  for (const repo of activeRepos) {
    for (const taskType of dueTypes) {
      steps.push({ repo, taskType });
    }
  }
  return steps;
}

// re-export for callers that only need the weekday list
export { WEEKDAYS };
