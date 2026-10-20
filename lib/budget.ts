import { DEFAULT_TASK_TYPES } from "./task-types";

// Pure domain logic for the weekly budget on Bug/Requirement work (req-044):
// a shared ceiling on how many packages the worker may work off per repo per
// week, so one repo that dreams up its own work cannot use up the whole
// Claude subscription and starve every other repo. Recurring task types
// (Security, Doku, Ideen, Code-Review) and Feedback are out of scope by the
// requirement — only Bugs and Requirements share this budget.

/** The task-type ids the weekly budget counts (req-044). */
export const BUDGET_TASK_IDS = ["bug", "requirement"];

export function isBudgetGoverned(taskTypeId: string): boolean {
  return BUDGET_TASK_IDS.includes(taskTypeId);
}

/**
 * The run-log labels ("Bugs", "Requirements") the weekly budget counts.
 * Fixed, not derived from the currently configured task types: a budget must
 * keep counting a label's past successes even if that type is later
 * deactivated or reordered — labels aren't user-editable, so there is
 * nothing else they could become.
 */
export const BUDGET_TASK_LABELS = DEFAULT_TASK_TYPES.filter((t) =>
  isBudgetGoverned(t.id),
).map((t) => t.label);

/** Leads every "budget used up" Verlauf row, so it can be recognized later. */
export const BUDGET_SKIP_PREFIX = "Wochenbudget aufgebraucht";

/**
 * Monday 00:00:00.000 local time of the week containing `now` (req-044 AC9:
 * a new week resets the count). JS getDay() is 0=Sunday..6=Saturday.
 */
export function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = d.getDay();
  const diffToMonday = weekday === 0 ? -6 : 1 - weekday;
  d.setDate(d.getDate() + diffToMonday);
  return d;
}

/**
 * Has this repo's weekly budget run out? `null`/`undefined` means no limit
 * was set — unlimited, as before req-044.
 */
export function isBudgetExhausted(
  weeklyBudget: number | null | undefined,
  usedThisWeek: number,
): boolean {
  if (weeklyBudget == null) return false;
  return usedThisWeek >= weeklyBudget;
}
