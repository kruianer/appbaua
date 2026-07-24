import {
  type TaskType,
  type Weekday,
  WEEKDAYS,
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

/**
 * Is this task type due to run right now? Inactive => never. always => yes.
 * Otherwise the current weekday must be enabled and (if a window is set) the
 * current time must fall within [start, end]; an enabled day with no window is
 * all-day.
 */
export function isTaskDue(t: TaskType, now: Date): boolean {
  if (!t.active) return false;
  if (t.always) return true;
  const day = weekdayOf(now);
  const ds = t.schedule[day];
  if (!ds || !ds.enabled) return false;
  const start = toMinutes(ds.start);
  const end = toMinutes(ds.end);
  if (start === null || end === null) return true; // enabled, no window = all day
  const nowMin = minutesOfDay(now);
  return nowMin >= start && nowMin <= end;
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
