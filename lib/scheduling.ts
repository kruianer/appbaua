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
 * Build the ordered list of steps for one run: task-type priority is the OUTER
 * loop, repo priority the INNER loop. Only active repos and active+due task
 * types are included. `repos` and `taskTypes` are already in priority order
 * (index 0 = highest).
 */
export function planRun(
  repos: Repo[],
  taskTypes: TaskType[],
  now: Date,
): PlannedStep[] {
  const activeRepos = repos.filter((r) => r.active);
  const dueTypes = taskTypes.filter((t) => isTaskDue(t, now));
  const steps: PlannedStep[] = [];
  for (const taskType of dueTypes) {
    for (const repo of activeRepos) {
      steps.push({ repo, taskType });
    }
  }
  return steps;
}

// re-export for callers that only need the weekday list
export { WEEKDAYS };
