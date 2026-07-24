import { getTaskStore } from "./task-store";
import {
  type DaySchedule,
  type TaskType,
  type Weekday,
  isValidWindow,
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

export type SetDayResult =
  | { ok: true; types: TaskType[] }
  | { ok: false; error: "invalid-window" | "not-found" };

/**
 * Set one weekday's schedule for a task type. An invalid window (end not after
 * start, or only one side filled) is rejected and nothing is saved.
 */
export async function setDaySchedule(
  id: string,
  day: Weekday,
  value: DaySchedule,
): Promise<SetDayResult> {
  const start = value.start && value.start.length > 0 ? value.start : null;
  const end = value.end && value.end.length > 0 ? value.end : null;

  if (!isValidWindow(start, end)) {
    return { ok: false, error: "invalid-window" };
  }

  const types = await getTaskStore().list();
  const target = types.find((t) => t.id === id);
  if (!target) return { ok: false, error: "not-found" };

  const next = types.map((t) =>
    t.id === id
      ? {
          ...t,
          schedule: {
            ...t.schedule,
            [day]: { enabled: value.enabled, start, end },
          },
        }
      : t,
  );
  const saved = await getTaskStore().replace(next);
  return { ok: true, types: saved };
}
