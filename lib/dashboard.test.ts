import { describe, it, expect } from "vitest";
import { buildDashboard, derivePhase, startOfTodayIso } from "./dashboard";
import { EMPTY_STATUS, type WorkerStatus } from "./worker-status";
import {
  DEFAULT_TASK_TYPES,
  defaultTaskTypes,
  emptySchedule,
} from "./task-types";
import type { Repo } from "./repos";
import type { RunLogEntry } from "./run-log";

const now = new Date(2026, 6, 22, 14, 30, 0); // Wed 14:30

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "u1", active: true },
  { id: "r2", name: "worker", url: "u2", active: true },
  { id: "r3", name: "aus", url: "u3", active: false },
];

describe("derivePhase", () => {
  const step: WorkerStatus = {
    ...EMPTY_STATUS,
    currentRepo: "appbaua",
    currentType: "Bugs",
    stepStartedAt: now.toISOString(),
  };
  it("stopped when disabled (even if a step is set)", () => {
    expect(derivePhase(false, step, now)).toBe("stopped");
  });
  it("running when a step is set and enabled", () => {
    expect(derivePhase(true, step, now)).toBe("running");
  });
  it("pause when pauseUntil is in the future", () => {
    const s: WorkerStatus = {
      ...EMPTY_STATUS,
      pauseUntil: new Date(now.getTime() + 60_000).toISOString(),
    };
    expect(derivePhase(true, s, now)).toBe("pause");
  });
  it("idle when pause window already elapsed", () => {
    const s: WorkerStatus = {
      ...EMPTY_STATUS,
      pauseUntil: new Date(now.getTime() - 60_000).toISOString(),
    };
    expect(derivePhase(true, s, now)).toBe("idle");
  });
  it("idle when nothing set", () => {
    expect(derivePhase(true, EMPTY_STATUS, now)).toBe("idle");
  });
});

describe("buildDashboard tiles", () => {
  const base = {
    status: EMPTY_STATUS,
    repos,
    taskTypes: defaultTaskTypes(), // all always-on -> all due
    today: { done: 3, errors: 1 },
    lastError: null as RunLogEntry | null,
    now,
  };

  it("counts active repos and total regardless of switch", () => {
    const on = buildDashboard({ ...base, enabled: true });
    const off = buildDashboard({ ...base, enabled: false });
    expect(on.activeRepos).toBe(2);
    expect(on.totalRepos).toBe(3);
    expect(off.activeRepos).toBe(2); // tiles reflect config even when stopped
    expect(off.totalRepos).toBe(3);
  });

  // bug-007: the expectation is derived, not a literal that has to be bumped
  // every time a recurring type joins the list (Security req-014, Doku req-016).
  it("counts due task types (all always-on -> every predefined type)", () => {
    const d = buildDashboard({ ...base, enabled: true });
    expect(d.dueTypes).toBe(DEFAULT_TASK_TYPES.length);
  });

  it("leaves out types that are inactive or outside their window", () => {
    const [bug, requirement, ...rest] = defaultTaskTypes();
    const morningOnly = emptySchedule();
    morningOnly.wed = { enabled: true, start: "09:00", end: "12:00" }; // now is Wed 14:30
    const d = buildDashboard({
      ...base,
      enabled: true,
      taskTypes: [
        { ...bug, active: false },
        { ...requirement, always: false, schedule: morningOnly },
        ...rest,
      ],
    });
    expect(d.dueTypes).toBe(rest.length);
  });

  it("passes today's metrics through", () => {
    const d = buildDashboard({ ...base, enabled: true });
    expect(d.today).toEqual({ done: 3, errors: 1 });
  });

  it("lastError null -> null (UI shows 'Kein Fehler bisher')", () => {
    const d = buildDashboard({ ...base, enabled: true });
    expect(d.lastError).toBeNull();
  });

  it("lastError present -> at + message", () => {
    const err: RunLogEntry = {
      id: 1,
      startedAt: now.toISOString(),
      endedAt: now.toISOString(),
      repo: "appbaua",
      taskType: "Bugs",
      status: "error",
      message: "Simuliert: Schritt fehlgeschlagen",
    };
    const d = buildDashboard({ ...base, enabled: true, lastError: err });
    expect(d.lastError).toEqual({
      at: err.endedAt,
      message: "Simuliert: Schritt fehlgeschlagen",
    });
  });
});

describe("buildDashboard — running step details (req-008)", () => {
  const base = {
    enabled: true,
    repos,
    taskTypes: defaultTaskTypes(),
    today: { done: 0, errors: 0 },
    lastError: null as RunLogEntry | null,
    now,
  };
  const running: WorkerStatus = {
    currentRepo: "appbaua",
    currentType: "Requirements",
    currentMd: "req-042-beispiel.md",
    currentOutput: "Zeile 1\nZeile 2",
    stepStartedAt: now.toISOString(),
    pauseUntil: null,
  };

  it("passes the .md name and the live output through while running", () => {
    const d = buildDashboard({ ...base, status: running });
    expect(d.phase).toBe("running");
    expect(d.currentMd).toBe("req-042-beispiel.md");
    expect(d.currentOutput).toBe("Zeile 1\nZeile 2");
  });

  it("a recurring step has no .md name", () => {
    const d = buildDashboard({
      ...base,
      status: { ...running, currentType: "Code-Review", currentMd: null },
    });
    expect(d.currentMd).toBeNull();
  });

  it("AC: nothing running -> no .md name and no live output", () => {
    // Leftovers in the status row must not survive the end of the step.
    const d = buildDashboard({
      ...base,
      status: { ...running, currentRepo: null, currentType: null },
    });
    expect(d.phase).toBe("idle");
    expect(d.currentMd).toBeNull();
    expect(d.currentOutput).toBeNull();
  });

  it("stopped worker shows no live output either", () => {
    const d = buildDashboard({ ...base, enabled: false, status: running });
    expect(d.phase).toBe("stopped");
    expect(d.currentOutput).toBeNull();
  });
});

describe("startOfTodayIso", () => {
  it("is local midnight of the given day", () => {
    const iso = startOfTodayIso(now);
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(22);
  });
});
