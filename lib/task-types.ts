// Domain type + pure helpers for the task-type list (req-002). No I/O here so
// these are trivially unit-testable and shared between server and tests.

export const WEEKDAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type Weekday = (typeof WEEKDAYS)[number];

export const WEEKDAY_LABELS: Record<Weekday, string> = {
  mon: "Montag",
  tue: "Dienstag",
  wed: "Mittwoch",
  thu: "Donnerstag",
  fri: "Freitag",
  sat: "Samstag",
  sun: "Sonntag",
};

/**
 * A day's schedule for one task type. `enabled` is the weekday checkbox.
 * start/end are "HH:MM" or null. Both null with enabled=true means "all day".
 */
export type DaySchedule = {
  enabled: boolean;
  start: string | null;
  end: string | null;
};

export type Schedule = Record<Weekday, DaySchedule>;

export type TaskType = {
  id: string; // stable slug, e.g. "bug"
  label: string; // display name, e.g. "Bugs"
  active: boolean;
  /** When true, the type runs around the clock and the weekday view hides. */
  always: boolean;
  schedule: Schedule;
};

/**
 * The predefined types in the vision order P1–P5. Security sits next to
 * Code-Review, because the vision puts "Code-Review & Security-Review" on the
 * same priority P3 (req-014).
 */
export const DEFAULT_TASK_TYPES: { id: string; label: string }[] = [
  { id: "bug", label: "Bugs" },
  { id: "requirement", label: "Requirements" },
  { id: "code-review", label: "Code-Review" },
  { id: "security", label: "Security" },
  { id: "doku", label: "Doku" },
  { id: "ideen", label: "Ideen" },
];

export function emptySchedule(): Schedule {
  return WEEKDAYS.reduce((acc, d) => {
    acc[d] = { enabled: false, start: null, end: null };
    return acc;
  }, {} as Schedule);
}

function freshTaskType(t: { id: string; label: string }): TaskType {
  return {
    id: t.id,
    label: t.label,
    active: true,
    always: true, // default: runs anytime until the user restricts it
    schedule: emptySchedule(),
  };
}

export function defaultTaskTypes(): TaskType[] {
  return DEFAULT_TASK_TYPES.map(freshTaskType);
}

/**
 * Where a missing predefined type goes in a list the user has reordered: right
 * after the nearest default predecessor that is still there, else right before
 * the nearest default successor (so a high-priority type does not land last),
 * else at the end.
 */
function insertionIndex(list: TaskType[], defIndex: number): number {
  for (let i = defIndex - 1; i >= 0; i--) {
    const pos = list.findIndex((t) => t.id === DEFAULT_TASK_TYPES[i].id);
    if (pos >= 0) return pos + 1;
  }
  for (let i = defIndex + 1; i < DEFAULT_TASK_TYPES.length; i++) {
    const pos = list.findIndex((t) => t.id === DEFAULT_TASK_TYPES[i].id);
    if (pos >= 0) return pos;
  }
  return list.length;
}

/**
 * Add predefined types the stored list does not have yet, each at its place in
 * the default order, and leave everything else — order, active, schedules —
 * untouched.
 *
 * Why: the store seeds the defaults only when it is EMPTY, so a type added
 * later (Security, req-014) would never show up in an installation that was
 * seeded before. Returns the same array instance when nothing was missing, so
 * callers can tell "unchanged" without comparing.
 */
export function withMissingDefaults(stored: TaskType[]): TaskType[] {
  const known = new Set(stored.map((t) => t.id));
  const missing = DEFAULT_TASK_TYPES.filter((t) => !known.has(t.id));
  if (missing.length === 0) return stored;

  const next = [...stored];
  for (const def of missing) {
    const defIndex = DEFAULT_TASK_TYPES.findIndex((t) => t.id === def.id);
    next.splice(insertionIndex(next, defIndex), 0, freshTaskType(def));
  }
  return next;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidTime(value: string): boolean {
  return HHMM.test(value);
}

/** Minutes since midnight for a valid "HH:MM", else null. */
export function toMinutes(value: string | null): number | null {
  if (!value || !isValidTime(value)) return null;
  const [h, m] = value.split(":").map(Number);
  return h * 60 + m;
}

/**
 * A day window is valid when: both times empty (= all day), OR both set to
 * different times. An end BEFORE the start is a window over midnight
 * (22:00–06:00) and explicitly allowed — the vision asks for night windows
 * (bug-004). Invalid: only one side set, or start === end (an empty window; use
 * both-empty, i.e. prefillDay's 00:00–23:59, for all day).
 */
export function isValidWindow(start: string | null, end: string | null): boolean {
  if (!start && !end) return true;
  const s = toMinutes(start);
  const e = toMinutes(end);
  if (s === null || e === null) return false;
  return e !== s;
}

/** True when a window wraps around midnight, i.e. its end lies before its start. */
export function isOvernightWindow(start: number, end: number): boolean {
  return end < start;
}

/**
 * Is `nowMin` (minutes since midnight) inside the window [start, end]? Both
 * ends are inclusive. A window over midnight covers both sides of it, so
 * 22:00–06:00 matches 22:00–23:59 and 00:00–06:00.
 */
export function isWithinWindow(
  nowMin: number,
  start: number,
  end: number,
): boolean {
  if (isOvernightWindow(start, end)) return nowMin >= start || nowMin <= end;
  return nowMin >= start && nowMin <= end;
}

/** True when an active type runs around the clock (the "immer" flag). */
export function runsAlways(t: TaskType): boolean {
  return t.active && t.always;
}

/**
 * Fill empty sides of a window when a day is enabled: empty start -> "00:00",
 * empty end -> "23:59". A day that is disabled is returned unchanged.
 */
export function prefillDay(day: DaySchedule): DaySchedule {
  if (!day.enabled) return day;
  return {
    enabled: true,
    start: day.start && day.start.length > 0 ? day.start : "00:00",
    end: day.end && day.end.length > 0 ? day.end : "23:59",
  };
}
