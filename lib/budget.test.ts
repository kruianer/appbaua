import { describe, it, expect } from "vitest";
import {
  BUDGET_TASK_LABELS,
  isBudgetExhausted,
  isBudgetGoverned,
  startOfWeek,
} from "./budget";

describe("isBudgetGoverned (req-044)", () => {
  it("counts bug and requirement, nothing else", () => {
    expect(isBudgetGoverned("bug")).toBe(true);
    expect(isBudgetGoverned("requirement")).toBe(true);
    expect(isBudgetGoverned("feedback")).toBe(false);
    expect(isBudgetGoverned("security")).toBe(false);
    expect(isBudgetGoverned("doku")).toBe(false);
    expect(isBudgetGoverned("ideen")).toBe(false);
    expect(isBudgetGoverned("code-review")).toBe(false);
  });
});

describe("BUDGET_TASK_LABELS (req-044)", () => {
  it("is exactly Bugs and Requirements", () => {
    expect(BUDGET_TASK_LABELS).toEqual(["Bugs", "Requirements"]);
  });
});

describe("startOfWeek (req-044 AC9)", () => {
  it("returns the Monday of the current week at local midnight", () => {
    const wed = new Date(2026, 6, 22, 18, 30); // Wed 22.07.2026
    expect(startOfWeek(wed)).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
  });

  it("a Monday maps to itself at midnight", () => {
    const mon = new Date(2026, 6, 20, 9, 0);
    expect(startOfWeek(mon)).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
  });

  it("a Sunday maps to the Monday before it", () => {
    const sun = new Date(2026, 6, 26, 23, 0); // Sun 26.07.2026
    expect(startOfWeek(sun)).toEqual(new Date(2026, 6, 20, 0, 0, 0, 0));
  });
});

describe("isBudgetExhausted (req-044)", () => {
  it("no budget set (null/undefined) is never exhausted — unlimited", () => {
    expect(isBudgetExhausted(null, 1000)).toBe(false);
    expect(isBudgetExhausted(undefined, 1000)).toBe(false);
  });

  it("used below the budget is not exhausted", () => {
    expect(isBudgetExhausted(3, 2)).toBe(false);
  });

  it("used at or above the budget is exhausted", () => {
    expect(isBudgetExhausted(3, 3)).toBe(true);
    expect(isBudgetExhausted(3, 4)).toBe(true);
  });
});
