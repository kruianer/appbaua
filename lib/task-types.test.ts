import { describe, it, expect } from "vitest";
import {
  DEFAULT_TASK_TYPES,
  defaultTaskTypes,
  isValidTime,
  isValidWindow,
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
  it("end before start = invalid", () => {
    expect(isValidWindow("19:00", "17:00")).toBe(false);
  });
  it("equal start/end = invalid", () => {
    expect(isValidWindow("10:00", "10:00")).toBe(false);
  });
  it("only one side filled = invalid", () => {
    expect(isValidWindow("09:00", null)).toBe(false);
    expect(isValidWindow(null, "09:00")).toBe(false);
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
