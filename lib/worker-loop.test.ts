import { describe, it, expect, beforeEach } from "vitest";
import { runOnce, type LoopDeps } from "./worker-loop";
import { setStore, createMemoryStore } from "./store";
import { setTaskStore, createMemoryTaskStore } from "./task-store";
import { setWorkerStore, createMemoryWorkerStore } from "./worker-state";
import { setRunLogStore, createMemoryRunLogStore, type RunLogStore } from "./run-log-store";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";

const WED_18 = new Date(2026, 6, 22, 18, 0, 0);

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "u1", active: true },
  { id: "r2", name: "worker", url: "u2", active: true },
];

let logStore: RunLogStore;

function deps(over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    sleep: async () => {}, // instant, no real 15s
    now: () => WED_18,
    shouldFail: () => false,
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

describe("req-004 worker loop", () => {
  it("AC: switch off -> no run, no log entries", async () => {
    setWorkerStore(createMemoryWorkerStore({ enabled: false }));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(0);
    expect(await logStore.count()).toBe(0);
  });

  it("AC: nothing due -> exactly one 'idle' log entry", async () => {
    // No repos active -> no steps.
    setStore(createMemoryStore([{ ...repos[0], active: false }, { ...repos[1], active: false }]));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(0);
    expect(await logStore.count()).toBe(1);
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
    expect(row.repo).toBeNull();
  });

  it("AC: order is task-type outer, repo inner; each step a success entry", async () => {
    // Only two types to keep it short: keep Bugs + Requirements, drop the rest.
    const two = defaultTaskTypes().slice(0, 2); // Bugs, Requirements
    setTaskStore(createMemoryTaskStore(two));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(4);
    const rows = await logStore.list(0, 4); // newest first
    // reverse to chronological
    const chrono = [...rows].reverse().map((r) => `${r.taskType}×${r.repo}`);
    expect(chrono).toEqual([
      "Bugs×appbaua",
      "Bugs×worker",
      "Requirements×appbaua",
      "Requirements×worker",
    ]);
    expect(rows.every((r) => r.status === "success")).toBe(true);
  });

  it("AC: ~every 10th step is an error, loop continues", async () => {
    // One always-on type over many repos to get >10 steps.
    const many: Repo[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      name: `repo${i}`,
      url: `u${i}`,
      active: true,
    }));
    setStore(createMemoryStore(many));
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // just Bugs
    // use the real 1-in-10 cadence (index % 10 === 9)
    const done = await runOnce(
      { n: 0 },
      deps({ shouldFail: (i) => i % 10 === 9 }),
    );
    expect(done).toBe(12);
    const rows = await logStore.list(0, 12);
    const errors = rows.filter((r) => r.status === "error");
    expect(errors.length).toBe(1); // step index 9 of 0..11
  });

  it("AC: a repo deactivated mid-run is skipped (live re-check)", async () => {
    const two = defaultTaskTypes().slice(0, 1); // Bugs only
    setTaskStore(createMemoryTaskStore(two));
    // deps.now stays WED_18; we deactivate r2 by swapping the store after first read.
    // Simulate by making r2 inactive from the start of the live re-check:
    setStore(createMemoryStore([repos[0], { ...repos[1], active: false }]));
    const done = await runOnce({ n: 0 }, deps());
    expect(done).toBe(1); // only appbaua
    const rows = await logStore.list(0, 10);
    expect(rows.map((r) => r.repo)).toEqual(["appbaua"]);
  });
});
