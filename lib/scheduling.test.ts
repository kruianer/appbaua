import { describe, it, expect } from "vitest";
import {
  WEEKDAYS,
  isTaskDue,
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
    { id: "r1", name: "appbaua", url: "u1", active: true },
    { id: "r2", name: "worker", url: "u2", active: true },
    { id: "r3", name: "aus", url: "u3", active: false },
  ];

  it("orders task-type priority outer, repo priority inner; skips inactive", () => {
    const [bug, req] = defaultTaskTypes(); // both always-on, active
    const steps = planRun(repos, [bug, req], WED_18);
    expect(
      steps.map((s) => `${s.taskType.label}×${s.repo.name}`),
    ).toEqual([
      "Bugs×appbaua",
      "Bugs×worker",
      "Requirements×appbaua",
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
