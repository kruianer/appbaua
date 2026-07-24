import { describe, it, expect, beforeEach } from "vitest";
import { runOnce, type LoopDeps } from "./worker-loop";
import { setStore, createMemoryStore } from "./store";
import { setTaskStore, createMemoryTaskStore } from "./task-store";
import { setWorkerStore, createMemoryWorkerStore } from "./worker-state";
import {
  setRunLogStore,
  createMemoryRunLogStore,
  type RunLogStore,
} from "./run-log-store";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";
import type { StepDecision } from "./execute-step";

const WED_18 = new Date(2026, 6, 22, 18, 0, 0);

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "u1", active: true },
  { id: "r2", name: "worker", url: "u2", active: true },
];

let logStore: RunLogStore;

// Default fake step: everything succeeds instantly (no git, no Claude).
function deps(over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    sleep: async () => {},
    now: () => WED_18,
    runStep: async () => ({ kind: "success", message: "ok" }) as StepDecision,
    setRunningStep: async () => {},
    clearRunningStep: async () => {},
    setPauseUntil: async () => {},
    ...over,
  };
}

beforeEach(() => {
  setStore(createMemoryStore(repos));
  setTaskStore(createMemoryTaskStore(defaultTaskTypes())); // all always-on, active
  setWorkerStore(createMemoryWorkerStore({ enabled: true }));
  logStore = createMemoryRunLogStore();
  setRunLogStore(logStore);
});

describe("worker loop (req-004 orchestration, req-006 real steps)", () => {
  it("AC: switch off -> no run, no log entries", async () => {
    setWorkerStore(createMemoryWorkerStore({ enabled: false }));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(0);
    expect(await logStore.count()).toBe(0);
  });

  it("AC: nothing due -> exactly one 'idle' log entry", async () => {
    setStore(
      createMemoryStore([
        { ...repos[0], active: false },
        { ...repos[1], active: false },
      ]),
    );
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(0);
    expect(await logStore.count()).toBe(1);
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
  });

  it("AC: order is task-type outer, repo inner; success entries", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 2))); // Bugs, Requirements
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(4);
    const rows = await logStore.list(0, 4);
    const chrono = [...rows].reverse().map((r) => `${r.taskType}×${r.repo}`);
    expect(chrono).toEqual([
      "Bugs×appbaua",
      "Bugs×worker",
      "Requirements×appbaua",
      "Requirements×worker",
    ]);
    expect(rows.every((r) => r.status === "success")).toBe(true);
  });

  it("AC: a skipped step produces NO log entry", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    // appbaua skips (empty ready/), worker succeeds.
    const runStep = async (repo: Repo): Promise<StepDecision> =>
      repo.name === "appbaua"
        ? { kind: "skip" }
        : { kind: "success", message: "ok" };
    const done = await runOnce({ n: 0 }, deps({ runStep }));
    expect(done).toBe(1); // only worker counted
    const rows = await logStore.list(0, 10);
    expect(rows.map((r) => r.repo)).toEqual(["worker"]); // appbaua not logged
  });

  it("AC: an error step is logged as 'error' and the loop continues", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const runStep = async (repo: Repo): Promise<StepDecision> =>
      repo.name === "appbaua"
        ? { kind: "error", message: "Claude-Lauf fehlgeschlagen" }
        : { kind: "success", message: "ok" };
    const done = await runOnce({ n: 0 }, deps({ runStep }));
    expect(done).toBe(2);
    const rows = [...(await logStore.list(0, 10))].reverse();
    expect(rows.map((r) => `${r.repo}:${r.status}`)).toEqual([
      "appbaua:error",
      "worker:success",
    ]);
  });

  it("a throwing step is logged as 'error' and the loop continues", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const runStep = async (repo: Repo): Promise<StepDecision> => {
      if (repo.name === "appbaua") throw new Error("boom");
      return { kind: "success", message: "ok" };
    };
    let cleared = 0;
    const done = await runOnce(
      { n: 0 },
      deps({ runStep, clearRunningStep: async () => void cleared++ }),
    );
    expect(done).toBe(2); // appbaua (error) + worker (success) both logged
    const rows = [...(await logStore.list(0, 10))].reverse();
    expect(rows.map((r) => `${r.repo}:${r.status}`)).toEqual([
      "appbaua:error",
      "worker:success",
    ]);
    expect(rows[0].message).toContain("boom");
    expect(cleared).toBeGreaterThan(0); // running status cleared even on throw
  });

  it("AC: a repo deactivated mid-run is skipped (live re-check)", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    setStore(createMemoryStore([repos[0], { ...repos[1], active: false }]));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(1);
    const rows = await logStore.list(0, 10);
    expect(rows.map((r) => r.repo)).toEqual(["appbaua"]);
  });
});
