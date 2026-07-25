import { getTaskStore } from "./task-store";
import {
  type DaySchedule,
  type TaskType,
  type Weekday,
  isValidWindow,
  prefillDay,
} from "./task-types";

// Application service for req-002. Routes stay thin and call these; tests
// exercise them directly. The five task types are predefined and seeded by the
// store — there is deliberately no create/delete here.

export async function listTaskTypes(): Promise<TaskType[]> {
  return getTaskStore().list();
}

/** Reorder to exactly the given id order (index 0 = highest priority). */
export async function reorderTaskTypes(
  orderedIds: string[],
): Promise<TaskType[]> {
  const types = await getTaskStore().list();
  const byId = new Map(types.map((t) => [t.id, t]));
  const next: TaskType[] = [];
  for (const id of orderedIds) {
    const t = byId.get(id);
    if (t) {
      next.push(t);
      byId.delete(id);
    }
  }
  for (const t of types) if (byId.has(t.id)) next.push(t);
  return getTaskStore().replace(next);
}

export async function toggleTaskType(id: string): Promise<TaskType[]> {
  const types = await getTaskStore().list();
  const next = types.map((t) =>
    t.id === id ? { ...t, active: !t.active } : t,
  );
  return getTaskStore().replace(next);
}

/** Toggle the "immer" flag. Weekday schedule is kept untouched underneath. */
export async function toggleAlways(id: string): Promise<TaskType[]> {
  const types = await getTaskStore().list();
  const next = types.map((t) =>
    t.id === id ? { ...t, always: !t.always } : t,
  );
  return getTaskStore().replace(next);
}

export type SetDayResult =
  | { ok: true; types: TaskType[] }
  | { ok: false; error: "invalid-window" | "not-found" };

/**
 * Set one weekday's schedule for a task type. An invalid window (start and end
 * identical, or only one side filled and the day disabled) is rejected and
 * nothing is saved. A window over midnight like 22:00–06:00 is valid.
 */
export async function setDaySchedule(
  id: string,
  day: Weekday,
  value: DaySchedule,
): Promise<SetDayResult> {
  const normalized: DaySchedule = {
    enabled: value.enabled,
    start: value.start && value.start.length > 0 ? value.start : null,
    end: value.end && value.end.length > 0 ? value.end : null,
  };

  // When the day is enabled, fill empty sides (00:00 / 23:59) so a freshly
  // ticked day gets a full-day window instead of an empty one.
  const dayValue = prefillDay(normalized);

  if (!isValidWindow(dayValue.start, dayValue.end)) {
    return { ok: false, error: "invalid-window" };
  }

  const types = await getTaskStore().list();
  const target = types.find((t) => t.id === id);
  if (!target) return { ok: false, error: "not-found" };

  const next = types.map((t) =>
    t.id === id
      ? { ...t, schedule: { ...t.schedule, [day]: dayValue } }
      : t,
  );
  const saved = await getTaskStore().replace(next);
  return { ok: true, types: saved };
}
