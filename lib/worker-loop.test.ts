import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runOnce,
  runForever,
  EMPTY_PAUSE_MS,
  type LoopDeps,
} from "./worker-loop";
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
    expect(done).toBe(1); // the error is logged but is not progress (bug-002)
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
    expect(done).toBe(1); // both logged, but only worker actually got work done
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

// bug-002: errors used to count as work done, so a step that failed on every
// pass (missing Claude CLI, no push rights, broken repo) kept the loop from
// ever pausing — git fetch every few seconds, a run log filling up, rate
// limits burnt.
describe("worker loop — Dauerfehler pausiert (bug-002)", () => {
  it("a pass in which every step fails got nothing done", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const runStep = async (): Promise<StepDecision> => ({
      kind: "error",
      message: "Claude-Code-CLI nicht verfügbar",
    });
    const done = await runOnce({ n: 0 }, deps({ runStep }));
    expect(done).toBe(0);
    expect(await logStore.count()).toBe(2); // still logged, both repos
  });

  it("AC: a permanently failing step pauses between passes instead of spinning", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs, 2 repos
    const stop = new Error("stop"); // runForever is endless; leave it from sleep
    const pauses: number[] = [];
    let steps = 0;
    const d = deps({
      runStep: async (): Promise<StepDecision> => {
        steps += 1;
        // Safety valve: without the fix nothing ever pauses, so stop feeding the
        // loop work after a generous budget — the test then fails on the step
        // count below instead of hanging until the timeout.
        if (steps > 20) return { kind: "skip" };
        return { kind: "error", message: "Claude-Code-CLI nicht verfügbar" };
      },
      sleep: async (ms: number) => {
        pauses.push(ms);
        if (pauses.length >= 3) throw stop;
      },
    });
    await expect(runForever(d)).rejects.toBe(stop);
    expect(pauses).toEqual([EMPTY_PAUSE_MS, EMPTY_PAUSE_MS, EMPTY_PAUSE_MS]);
    expect(steps).toBe(6); // 3 passes × 2 repos — not hundreds
  });

  it("a productive pass is not delayed — only a pass without progress pauses", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs, 2 repos
    const stop = new Error("stop");
    const pauses: number[] = [];
    let steps = 0;
    const d = deps({
      runStep: async (): Promise<StepDecision> => {
        steps += 1;
        // Two productive passes, then nothing left to do.
        return steps <= 4
          ? { kind: "success", message: "ok" }
          : { kind: "skip" };
      },
      sleep: async (ms: number) => {
        pauses.push(ms);
        throw stop;
      },
    });
    await expect(runForever(d)).rejects.toBe(stop);
    expect(pauses).toEqual([EMPTY_PAUSE_MS]); // only the third, empty pass
    expect(steps).toBe(6);
  });

  it("a pass that blows up entirely pauses too", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1)));
    // runForever logs the failed pass; keep the test output readable.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = new Error("stop");
    const pauses: number[] = [];
    const d = deps({
      setRunningStep: async () => {
        throw new Error("Status-Store weg");
      },
      sleep: async (ms: number) => {
        pauses.push(ms);
        throw stop;
      },
    });
    await expect(runForever(d)).rejects.toBe(stop);
    expect(pauses).toEqual([EMPTY_PAUSE_MS]);
    quiet.mockRestore();
  });
});

// bug-003: the run log is the last stop before a message becomes durable and
// visible in the UI. Whatever a step reports — and whichever tool leaked a
// credential into it — nothing with a token gets written here.
describe("worker loop — keine Credentials im Verlauf (bug-003)", () => {
  const PAT = "ghp_A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";

  it("AC: a logged git error contains no token", async () => {
    setStore(createMemoryStore([repos[0]]));
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const runStep = async (): Promise<StepDecision> => ({
      kind: "error",
      message:
        "Repo vorbereiten fehlgeschlagen: Error: clone failed: fatal: unable " +
        `to access 'https://x-access-token:${PAT}@github.com/kruianer/appbaua.git/'`,
    });
    await runOnce({ n: 0 }, deps({ runStep }));
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("error");
    expect(row.message).not.toContain(PAT);
    expect(row.message).toContain("clone failed"); // still says what went wrong
  });

  it("leaves an ordinary message untouched", async () => {
    setStore(createMemoryStore([repos[0]]));
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1)));
    const runStep = async (): Promise<StepDecision> => ({
      kind: "success",
      message: "bug-003.md abgearbeitet — auf dev gepusht",
    });
    await runOnce({ n: 0 }, deps({ runStep }));
    const [row] = await logStore.list(0, 1);
    expect(row.message).toBe("bug-003.md abgearbeitet — auf dev gepusht");
  });
});
