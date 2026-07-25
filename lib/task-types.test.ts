import { describe, it, expect } from "vitest";
import {
  DEFAULT_TASK_TYPES,
  defaultTaskTypes,
  isOvernightWindow,
  isValidTime,
  isValidWindow,
  isWithinWindow,
  prefillDay,
  runsAlways,
  toMinutes,
} from "./task-types";

describe("defaultTaskTypes", () => {
  it("are the five vision types in order P1–P5", () => {
    expect(defaultTaskTypes().map((t) => t.label)).toEqual([
      "Bugs",
      "Requirements",
      "Code-Review",
      "Doku",
      "Ideen",
    ]);
  });
  it("all start active, always-on, with an empty schedule", () => {
    for (const t of defaultTaskTypes()) {
      expect(t.active).toBe(true);
      expect(t.always).toBe(true);
      expect(Object.values(t.schedule).every((d) => !d.enabled)).toBe(true);
    }
  });
  it("has exactly five predefined types", () => {
    expect(DEFAULT_TASK_TYPES).toHaveLength(5);
  });
});

describe("isValidTime", () => {
  it("accepts HH:MM in 24h", () => {
    expect(isValidTime("17:00")).toBe(true);
    expect(isValidTime("00:00")).toBe(true);
    expect(isValidTime("23:59")).toBe(true);
  });
  it("rejects malformed or out-of-range", () => {
    expect(isValidTime("24:00")).toBe(false);
    expect(isValidTime("9:5")).toBe(false);
    expect(isValidTime("abc")).toBe(false);
  });
});

describe("toMinutes", () => {
  it("converts HH:MM to minutes", () => {
    expect(toMinutes("01:30")).toBe(90);
  });
  it("is null for invalid input", () => {
    expect(toMinutes(null)).toBeNull();
    expect(toMinutes("bad")).toBeNull();
  });
});

describe("isValidWindow", () => {
  it("both empty = all day = valid", () => {
    expect(isValidWindow(null, null)).toBe(true);
  });
  it("end after start = valid", () => {
    expect(isValidWindow("17:00", "19:00")).toBe(true);
  });
  // bug-004: end before start is a window over midnight, not an error.
  it("end before start = window over midnight = valid", () => {
    expect(isValidWindow("22:00", "06:00")).toBe(true);
    expect(isValidWindow("19:00", "17:00")).toBe(true);
    expect(isValidWindow("23:59", "00:00")).toBe(true);
  });
  it("equal start/end = invalid", () => {
    expect(isValidWindow("10:00", "10:00")).toBe(false);
  });
  it("only one side filled = invalid", () => {
    expect(isValidWindow("09:00", null)).toBe(false);
    expect(isValidWindow(null, "09:00")).toBe(false);
  });
  it("malformed times = invalid", () => {
    expect(isValidWindow("22:00", "6:0")).toBe(false);
    expect(isValidWindow("24:00", "06:00")).toBe(false);
  });
});

describe("isOvernightWindow", () => {
  it("is true only when the end lies before the start", () => {
    expect(isOvernightWindow(22 * 60, 6 * 60)).toBe(true);
    expect(isOvernightWindow(9 * 60, 17 * 60)).toBe(false);
    expect(isOvernightWindow(10 * 60, 10 * 60)).toBe(false);
  });
});

describe("isWithinWindow", () => {
  const start = 22 * 60; // 22:00
  const end = 6 * 60; // 06:00

  it("same-day window includes both ends and excludes the outside", () => {
    expect(isWithinWindow(9 * 60, 9 * 60, 17 * 60)).toBe(true); // 09:00
    expect(isWithinWindow(17 * 60, 9 * 60, 17 * 60)).toBe(true); // 17:00
    expect(isWithinWindow(8 * 60 + 59, 9 * 60, 17 * 60)).toBe(false);
    expect(isWithinWindow(17 * 60 + 1, 9 * 60, 17 * 60)).toBe(false);
  });

  it("window over midnight covers the late evening", () => {
    expect(isWithinWindow(22 * 60, start, end)).toBe(true); // 22:00
    expect(isWithinWindow(23 * 60 + 30, start, end)).toBe(true); // 23:30
    expect(isWithinWindow(23 * 60 + 59, start, end)).toBe(true); // 23:59
  });

  it("window over midnight covers the early morning", () => {
    expect(isWithinWindow(0, start, end)).toBe(true); // 00:00
    expect(isWithinWindow(2 * 60, start, end)).toBe(true); // 02:00
    expect(isWithinWindow(6 * 60, start, end)).toBe(true); // 06:00
  });

  it("window over midnight excludes the day in between", () => {
    expect(isWithinWindow(6 * 60 + 1, start, end)).toBe(false); // 06:01
    expect(isWithinWindow(12 * 60, start, end)).toBe(false); // 12:00
    expect(isWithinWindow(21 * 60 + 59, start, end)).toBe(false); // 21:59
  });
});

describe("runsAlways", () => {
  it("active type with the always flag runs always", () => {
    const [t] = defaultTaskTypes();
    expect(t.always).toBe(true);
    expect(runsAlways(t)).toBe(true);
  });
  it("always off = does not run always", () => {
    const t = { ...defaultTaskTypes()[0], always: false };
    expect(runsAlways(t)).toBe(false);
  });
  it("inactive type does not 'run always' even with always on", () => {
    const t = { ...defaultTaskTypes()[0], active: false, always: true };
    expect(runsAlways(t)).toBe(false);
  });
});

describe("prefillDay", () => {
  it("fills empty sides on an enabled day (00:00 / 23:59)", () => {
    expect(prefillDay({ enabled: true, start: null, end: null })).toEqual({
      enabled: true,
      start: "00:00",
      end: "23:59",
    });
  });
  it("fills only the empty side", () => {
    expect(prefillDay({ enabled: true, start: "09:00", end: null })).toEqual({
      enabled: true,
      start: "09:00",
      end: "23:59",
    });
  });
  it("leaves a disabled day untouched", () => {
    const d = { enabled: false, start: null, end: null };
    expect(prefillDay(d)).toEqual(d);
  });
});
