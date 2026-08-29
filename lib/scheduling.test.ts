import { describe, it, expect } from "vitest";
import {
  WEEKDAYS,
  isTaskDue,
  nextWindowStart,
  planPreview,
  planRun,
  previousWeekday,
  weekdayOf,
} from "./scheduling";
import { defaultTaskTypes, emptySchedule, type TaskType } from "./task-types";
import type { Repo } from "./repos";

// A Wednesday 18:00 local time.
const WED_18 = new Date(2026, 6, 22, 18, 0, 0); // 2026-07-22 is a Wednesday

function typeWith(overrides: Partial<TaskType>): TaskType {
  return {
    id: "bug",
    label: "Bugs",
    active: true,
    always: false,
    schedule: emptySchedule(),
    ...overrides,
  };
}

describe("weekdayOf", () => {
  it("maps a Wednesday date to 'wed'", () => {
    expect(weekdayOf(WED_18)).toBe("wed");
  });
});

describe("isTaskDue", () => {
  it("inactive type is never due", () => {
    expect(isTaskDue(typeWith({ active: false, always: true }), WED_18)).toBe(
      false,
    );
  });
  it("always-on type is due", () => {
    expect(isTaskDue(typeWith({ always: true }), WED_18)).toBe(true);
  });
  it("due when current weekday+time is inside the window", () => {
    const s = emptySchedule();
    s.wed = { enabled: true, start: "17:00", end: "19:00" };
    expect(isTaskDue(typeWith({ schedule: s }), WED_18)).toBe(true);
  });
  it("not due when outside the window", () => {
    const s = emptySchedule();
    s.wed = { enabled: true, start: "09:00", end: "12:00" };
    expect(isTaskDue(typeWith({ schedule: s }), WED_18)).toBe(false);
  });
  it("not due when the weekday is disabled", () => {
    const s = emptySchedule();
    s.thu = { enabled: true, start: "00:00", end: "23:59" };
    expect(isTaskDue(typeWith({ schedule: s }), WED_18)).toBe(false);
  });
  it("enabled day without a window = all day = due", () => {
    const s = emptySchedule();
    s.wed = { enabled: true, start: null, end: null };
    expect(isTaskDue(typeWith({ schedule: s }), WED_18)).toBe(true);
  });
});

describe("previousWeekday", () => {
  it("steps back one day and wraps mon -> sun", () => {
    expect(previousWeekday("tue")).toBe("mon");
    expect(previousWeekday("mon")).toBe("sun");
    expect(previousWeekday("sun")).toBe("sat");
  });
});

// bug-004: a window whose end lies before its start runs over midnight.
describe("isTaskDue with a window over midnight (bug-004)", () => {
  // 2026-07-20 is a Monday, 2026-07-21 the Tuesday after it.
  const MON_12 = new Date(2026, 6, 20, 12, 0, 0);
  const MON_23_30 = new Date(2026, 6, 20, 23, 30, 0);
  const TUE_02 = new Date(2026, 6, 21, 2, 0, 0);
  const WED_02 = new Date(2026, 6, 22, 2, 0, 0);

  /** Only Monday enabled, 22:00–06:00. */
  function nightType(): TaskType {
    const s = emptySchedule();
    s.mon = { enabled: true, start: "22:00", end: "06:00" };
    return typeWith({ schedule: s });
  }

  it("AC: Monday 22:00–06:00 is due on Monday 23:30", () => {
    expect(isTaskDue(nightType(), MON_23_30)).toBe(true);
  });

  it("AC: Monday 22:00–06:00 is due on Tuesday 02:00", () => {
    expect(isTaskDue(nightType(), TUE_02)).toBe(true);
  });

  it("AC: Monday 22:00–06:00 is NOT due on Monday 12:00", () => {
    expect(isTaskDue(nightType(), MON_12)).toBe(false);
  });

  it("does not reach further than the next morning", () => {
    expect(isTaskDue(nightType(), WED_02)).toBe(false);
  });

  it("boundaries of the spill into the next day are inclusive", () => {
    expect(isTaskDue(nightType(), new Date(2026, 6, 21, 0, 0, 0))).toBe(true);
    expect(isTaskDue(nightType(), new Date(2026, 6, 21, 6, 0, 0))).toBe(true);
    expect(isTaskDue(nightType(), new Date(2026, 6, 21, 6, 1, 0))).toBe(false);
  });

  it("a same-day window on the previous day does not spill over", () => {
    const s = emptySchedule();
    s.mon = { enabled: true, start: "09:00", end: "17:00" };
    expect(isTaskDue(typeWith({ schedule: s }), TUE_02)).toBe(false);
  });

  it("an all-day previous day stops at midnight", () => {
    const s = emptySchedule();
    s.mon = { enabled: true, start: null, end: null };
    expect(isTaskDue(typeWith({ schedule: s }), TUE_02)).toBe(false);
  });

  it("an inactive type stays not due even inside a night window", () => {
    expect(isTaskDue({ ...nightType(), active: false }, TUE_02)).toBe(false);
  });

  it("every night covered: 22:00–06:00 on all days is due at 02:00 any day", () => {
    const s = emptySchedule();
    for (const day of WEEKDAYS) {
      s[day] = { enabled: true, start: "22:00", end: "06:00" };
    }
    const t = typeWith({ schedule: s });
    expect(isTaskDue(t, TUE_02)).toBe(true);
    expect(isTaskDue(t, WED_02)).toBe(true);
    expect(isTaskDue(t, MON_12)).toBe(false);
  });
});

describe("planRun", () => {
  const repos: Repo[] = [
    { id: "r1", name: "appbaua", url: "u1", active: true, model: "sonnet", monitored: false },
    { id: "r2", name: "worker", url: "u2", active: true, model: "sonnet", monitored: false },
    { id: "r3", name: "aus", url: "u3", active: false, model: "sonnet", monitored: false },
  ];

  it("orders repo priority outer, task-type priority inner; skips inactive (bug-008)", () => {
    const [bug, req] = defaultTaskTypes(); // both always-on, active
    const steps = planRun(repos, [bug, req], WED_18);
    // Repo 1 (appbaua) completely before repo 2 (worker): the repo list is the
    // primary priority, not the task type.
    expect(
      steps.map((s) => `${s.taskType.label}×${s.repo.name}`),
    ).toEqual([
      "Bugs×appbaua",
      "Requirements×appbaua",
      "Bugs×worker",
      "Requirements×worker",
    ]);
  });

  it("excludes task types that are not due", () => {
    const bug = typeWith({ always: true, label: "Bugs" });
    const notDue = typeWith({
      id: "doku",
      label: "Doku",
      always: false,
      active: true,
    }); // no days -> not due
    const steps = planRun(repos, [bug, notDue], WED_18);
    expect(steps.every((s) => s.taskType.label === "Bugs")).toBe(true);
  });
});

describe("nextWindowStart (req-022)", () => {
  it("is null for an 'always' type — no next window, it is always due", () => {
    expect(nextWindowStart(typeWith({ always: true }), WED_18)).toBeNull();
  });

  it("is null when the type is due right now", () => {
    const t = typeWith({ always: false });
    t.schedule.wed = { enabled: true, start: "09:00", end: "20:00" }; // covers 18:00
    expect(nextWindowStart(t, WED_18)).toBeNull();
  });

  it("finds later today's window when it has not started yet", () => {
    const t = typeWith({ always: false });
    t.schedule.wed = { enabled: true, start: "22:00", end: "23:30" }; // after 18:00
    const at = nextWindowStart(t, WED_18);
    expect(at?.toISOString()).toBe(
      new Date(2026, 6, 22, 22, 0, 0).toISOString(),
    );
  });

  it("finds tomorrow's window when today has none left", () => {
    const t = typeWith({ always: false });
    t.schedule.thu = { enabled: true, start: "02:00", end: "06:00" }; // Thursday
    const at = nextWindowStart(t, WED_18);
    expect(at?.toISOString()).toBe(
      new Date(2026, 6, 23, 2, 0, 0).toISOString(),
    );
  });

  it("is null for an inactive type", () => {
    const t = typeWith({ active: false, always: false });
    t.schedule.thu = { enabled: true, start: "02:00", end: "06:00" };
    expect(nextWindowStart(t, WED_18)).toBeNull();
  });
});

describe("planPreview (req-022)", () => {
  const repos: Repo[] = [
    { id: "r1", name: "appbaua", url: "u1", active: true, model: "sonnet", monitored: false },
    { id: "r2", name: "worker", url: "u2", active: true, model: "sonnet", monitored: false },
  ];

  it("orders repo outer, task-type inner — same order the worker actually works", () => {
    const [bug, req] = defaultTaskTypes();
    const entries = planPreview(repos, [bug, req], WED_18);
    expect(entries.map((e) => `${e.taskType.label}×${e.repo.name}`)).toEqual([
      "Bugs×appbaua",
      "Requirements×appbaua",
      "Bugs×worker",
      "Requirements×worker",
    ]);
  });

  it("AC: an 'always' type due now gets a queue position, first one is 0", () => {
    const [bug] = defaultTaskTypes();
    const entries = planPreview([repos[0]], [bug], WED_18);
    expect(entries[0].due).toEqual({ kind: "queue", position: 0 });
  });

  it("AC: a scheduled type whose window is not open yet gets its next start", () => {
    const t = typeWith({ id: "doku", label: "Doku", always: false });
    t.schedule.thu = { enabled: true, start: "02:00", end: "06:00" };
    const entries = planPreview([repos[0]], [t], WED_18);
    expect(entries[0].due).toEqual({
      kind: "at",
      at: new Date(2026, 6, 23, 2, 0, 0),
    });
  });

  it("excludes inactive repos and inactive task types", () => {
    const [bug] = defaultTaskTypes();
    const inactiveRepo = [{ ...repos[0], active: false }];
    expect(planPreview(inactiveRepo, [bug], WED_18)).toEqual([]);
    const inactiveType = [{ ...bug, active: false }];
    expect(planPreview([repos[0]], inactiveType, WED_18)).toEqual([]);
  });
});
