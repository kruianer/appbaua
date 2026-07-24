import { describe, it, expect } from "vitest";
import { buildDashboard, derivePhase, startOfTodayIso } from "./dashboard";
import { EMPTY_STATUS, type WorkerStatus } from "./worker-status";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";
import type { RunLogEntry } from "./run-log";

const now = new Date(2026, 6, 22, 14, 30, 0); // Wed 14:30

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "u1", active: true },
  { id: "r2", name: "worker", url: "u2", active: true },
  { id: "r3", name: "aus", url: "u3", active: false },
];

describe("derivePhase", () => {
  it("stopped when disabled (even if a step is set)", () => {
    const s: WorkerStatus = {
      currentRepo: "appbaua",
      currentType: "Bugs",
      stepStartedAt: now.toISOString(),
      pauseUntil: null,
    };
    expect(derivePhase(false, s, now)).toBe("stopped");
  });
  it("running when a step is set and enabled", () => {
    const s: WorkerStatus = {
      currentRepo: "appbaua",
      currentType: "Bugs",
      stepStartedAt: now.toISOString(),
      pauseUntil: null,
    };
    expect(derivePhase(true, s, now)).toBe("running");
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

  it("counts due task types (all always-on = 5)", () => {
    const d = buildDashboard({ ...base, enabled: true });
    expect(d.dueTypes).toBe(5);
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

describe("startOfTodayIso", () => {
  it("is local midnight of the given day", () => {
    const iso = startOfTodayIso(now);
    const d = new Date(iso);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getDate()).toBe(22);
  });
});
