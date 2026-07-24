import { describe, it, expect } from "vitest";
import { isTaskDue, planRun, weekdayOf } from "./scheduling";
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
