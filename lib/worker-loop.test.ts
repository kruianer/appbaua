import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  runOnce,
  runForever,
  EMPTY_PAUSE_MS,
  PAUSE_POLL_MS,
  type LoopDeps,
} from "./worker-loop";
import { setStore, createMemoryStore } from "./store";
import { setTaskStore, createMemoryTaskStore } from "./task-store";
import {
  setWorkerStore,
  createMemoryWorkerStore,
  setWorkerEnabled,
  getWorkerState,
} from "./worker-state";
import {
  setWorkerStatusStore,
  createMemoryWorkerStatusStore,
  getWorkerStatusStore,
  setPauseUntil,
} from "./worker-status";
import { derivePhase } from "./dashboard";
import {
  setRunLogStore,
  createMemoryRunLogStore,
  type RunLogStore,
} from "./run-log-store";
import { defaultTaskTypes } from "./task-types";
import { RECURRING_MD, mdLabel } from "./run-log";
import type { Repo } from "./repos";
import type { StepDecision } from "./execute-step";

const WED_18 = new Date(2026, 6, 22, 18, 0, 0);

const repos: Repo[] = [
  { id: "r1", name: "appbaua", url: "u1", active: true, model: "sonnet", monitored: false },
  { id: "r2", name: "worker", url: "u2", active: true, model: "sonnet", monitored: false },
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
    updatePreview: async () => {},
    getPauseUntil: async () => null,
    isEnabled: async () => true,
    ...over,
  };
}

/**
 * A loop that really lives through its pauses (bug-022): the clock moves on
 * with every sleep slice, and the pause window goes through the REAL worker
 * status store — the same value a human edits in the database. Because a pause
 * is now slept in slices, tests count pause WINDOWS (ms waited from the moment
 * the window was written until the loop picked up again), not sleep calls.
 *
 * `onSlice` runs after every slice: that is where a test intervenes mid-pause
 * and where it throws to leave the endless loop.
 */
type PauseRig = {
  clock: number;
  /** ms waited per finished pause window, in order. */
  windows: number[];
  /** Every single sleep slice, in order. */
  slices: number[];
  /** Arguments of every setPauseUntil call the loop made. */
  pauseArgs: Array<{ iso: string | null; reason?: string | null }>;
  deps: LoopDeps;
};

function pauseRig(
  over: Partial<LoopDeps> = {},
  onSlice: (rig: PauseRig) => void | Promise<void> = () => {},
): PauseRig {
  let waited = 0;
  let open = false;
  const rig: PauseRig = {
    clock: WED_18.getTime(),
    windows: [],
    slices: [],
    pauseArgs: [],
    deps: null as unknown as LoopDeps,
  };
  rig.deps = deps({
    now: () => new Date(rig.clock),
    sleep: async (ms: number) => {
      rig.clock += ms;
      waited += ms;
      rig.slices.push(ms);
      await onSlice(rig);
    },
    // The real mutator and the real reader — a pause the loop writes is the
    // pause a human sees, and vice versa.
    setPauseUntil: async (iso, reason) => {
      rig.pauseArgs.push({ iso, reason });
      if (open) rig.windows.push(waited);
      waited = 0;
      open = iso !== null;
      await setPauseUntil(iso, reason ?? null);
    },
    getPauseUntil: async () => (await getWorkerStatusStore().get()).pauseUntil,
    isEnabled: async () => (await getWorkerState()).enabled,
    ...over,
  });
  return rig;
}

beforeEach(() => {
  setStore(createMemoryStore(repos));
  setTaskStore(createMemoryTaskStore(defaultTaskTypes())); // all always-on, active
  setWorkerStore(createMemoryWorkerStore({ enabled: true }));
  setWorkerStatusStore(createMemoryWorkerStatusStore());
  logStore = createMemoryRunLogStore();
  setRunLogStore(logStore);
});

describe("worker loop (req-004 orchestration, req-006 real steps)", () => {
  it("AC: switch off -> no run, no log entries", async () => {
    setWorkerStore(createMemoryWorkerStore({ enabled: false }));
    const done = await runOnce({ n: 0 }, deps());
    expect(done.succeeded).toBe(0);
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
    expect(done.succeeded).toBe(0);
    expect(await logStore.count()).toBe(1);
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
  });

  it("req-021: many idle passes collapse into ONE growing row", async () => {
    setStore(
      createMemoryStore([
        { ...repos[0], active: false },
        { ...repos[1], active: false },
      ]),
    );
    let clock = new Date(2026, 6, 22, 18, 0, 0).getTime();
    const d = deps({ now: () => new Date(clock) });
    await runOnce({ n: 0 }, d);
    clock += 5 * 60_000;
    await runOnce({ n: 0 }, d);
    clock += 5 * 60_000;
    await runOnce({ n: 0 }, d);
    // Three empty passes, one row (req-021) — not three "nichts zu tun" lines.
    expect(await logStore.count()).toBe(1);
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
    expect(row.message).toContain("seit"); // it grew into a summary
    expect(row.message).toContain("zuletzt geprüft");
  });

  it("bug-012: updatePreview runs at the START of a pass, before any step executes", async () => {
    const order: string[] = [];
    const runStep = async (): Promise<StepDecision> => {
      order.push("step");
      return { kind: "success", message: "ok" };
    };
    await runOnce(
      { n: 0 },
      deps({ runStep, updatePreview: async () => void order.push("preview") }),
    );
    // The whole point of bug-012: the preview is rebuilt BEFORE steps run, so
    // it never sits stale for the duration of a (possibly hour-long) step.
    expect(order[0]).toBe("preview");
    expect(order.filter((e) => e === "step").length).toBeGreaterThan(0);
  });

  it("req-022: updatePreview also runs after a normal pass (start AND end)", async () => {
    let calls = 0;
    await runOnce({ n: 0 }, deps({ updatePreview: async () => void calls++ }));
    expect(calls).toBe(2); // once before the pass (bug-012), once after (req-022)
  });

  it("req-022: the end-of-pass updatePreview is skipped during a rate-limit pause — the start-of-pass one still ran", async () => {
    let calls = 0;
    const runStep = async (): Promise<StepDecision> => ({
      kind: "rate-limited",
      message: "Rate-Limit: usage limit",
      pauseUntil: WED_18.getTime() + 60_000,
    });
    await runOnce(
      { n: 0 },
      deps({ runStep, updatePreview: async () => void calls++ }),
    );
    expect(calls).toBe(1); // the pre-pass refresh (bug-012), not the end-of-pass one
  });

  it("AC: order is repo outer, task-type inner; success entries (bug-008)", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 2))); // Bugs, Requirements
    const done = await runOnce({ n: 0 }, deps());
    expect(done.succeeded).toBe(4);
    const rows = await logStore.list(0, 4);
    const chrono = [...rows].reverse().map((r) => `${r.taskType}×${r.repo}`);
    expect(chrono).toEqual([
      "Bugs×appbaua",
      "Requirements×appbaua",
      "Bugs×worker",
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
    expect(done.succeeded).toBe(1); // only worker counted
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
    expect(done.succeeded).toBe(1); // the error is logged but is not progress (bug-002)
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
    expect(done.succeeded).toBe(1); // both logged, but only worker actually got work done
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
    expect(done.succeeded).toBe(1);
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
    expect(done.succeeded).toBe(0);
    expect(await logStore.count()).toBe(2); // still logged, both repos
  });

  it("AC: a permanently failing step pauses between passes instead of spinning", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs, 2 repos
    const stop = new Error("stop"); // runForever is endless; leave it from sleep
    let steps = 0;
    const rig = pauseRig(
      {
        runStep: async (): Promise<StepDecision> => {
          steps += 1;
          // Safety valve: without the fix nothing ever pauses, so stop feeding
          // the loop work after a generous budget — the test then fails on the
          // step count below instead of hanging until the timeout.
          if (steps > 20) return { kind: "skip" };
          return { kind: "error", message: "Claude-Code-CLI nicht verfügbar" };
        },
      },
      (r) => {
        if (r.windows.length >= 2) throw stop; // inside the third pause
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.windows).toEqual([EMPTY_PAUSE_MS, EMPTY_PAUSE_MS]); // waited out
    expect(steps).toBe(6); // 3 passes × 2 repos — not hundreds
  });

  it("a productive pass is not delayed — only a pass without progress pauses", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs, 2 repos
    const stop = new Error("stop");
    let steps = 0;
    const rig = pauseRig(
      {
        runStep: async (): Promise<StepDecision> => {
          steps += 1;
          // Two productive passes, then nothing left to do.
          return steps <= 4
            ? { kind: "success", message: "ok" }
            : { kind: "skip" };
        },
      },
      () => {
        throw stop; // the very first slice of the very first pause
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    // Only the third, empty pass paused at all — and for the empty-pause window.
    expect(rig.pauseArgs).toHaveLength(1);
    expect(rig.pauseArgs[0].iso).toBe(
      new Date(WED_18.getTime() + EMPTY_PAUSE_MS).toISOString(),
    );
    expect(steps).toBe(6);
  });

  it("req-029: a rate-limited step pauses until reset, with a reason, not the empty pause", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const stop = new Error("stop");
    const resetMs = WED_18.getTime() + 45 * 60_000; // 45 min ahead
    let rig!: PauseRig;
    rig = pauseRig(
      {
        // The reset always lies 45 min ahead of the CURRENT time, so a second
        // pass pauses again instead of spinning on a reset long past.
        runStep: async (): Promise<StepDecision> => ({
          kind: "rate-limited",
          message: "Rate-Limit: usage limit",
          pauseUntil: rig.clock + 45 * 60_000,
        }),
      },
      (r) => {
        if (r.windows.length >= 1) throw stop; // leave the loop after one pause
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    // Paused until the reset instant, carrying the rate-limit reason.
    expect(rig.pauseArgs[0].iso).toBe(new Date(resetMs).toISOString());
    expect(rig.pauseArgs[0].reason).toContain("Rate-Limit");
    // The wait matches the reset distance, not the 5-minute empty pause —
    // sliced up (bug-022), but the same total.
    expect(rig.windows[0]).toBe(resetMs - WED_18.getTime());
    expect(rig.windows[0]).not.toBe(EMPTY_PAUSE_MS);
  });

  it("bug-019: an auth-expired step pauses with its own reason, not the empty pause", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const stop = new Error("stop");
    const pauseMs = 6 * 60 * 60_000;
    const resumeMs = WED_18.getTime() + pauseMs;
    let rig!: PauseRig;
    rig = pauseRig(
      {
        runStep: async (): Promise<StepDecision> => ({
          kind: "auth-expired",
          message:
            "Anmeldung abgelaufen. Bitte im Worker-Container `claude login` ausführen.",
          pauseUntil: rig.clock + pauseMs,
        }),
      },
      (r) => {
        if (r.windows.length >= 1) throw stop; // leave the loop after one pause
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.pauseArgs[0].iso).toBe(new Date(resumeMs).toISOString());
    expect(rig.pauseArgs[0].reason).toContain("Anmeldung");
    expect(rig.windows[0]).toBe(resumeMs - WED_18.getTime());
    expect(rig.windows[0]).not.toBe(EMPTY_PAUSE_MS);
  });

  it("req-038: a network-abort step pauses briefly, with its own reason, not the empty pause", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const stop = new Error("stop");
    const pauseMs = 3 * 60_000;
    const resumeMs = WED_18.getTime() + pauseMs;
    let rig!: PauseRig;
    rig = pauseRig(
      {
        runStep: async (): Promise<StepDecision> => ({
          kind: "network-abort",
          message:
            "Netzabbruch (Versuch 1/3): API Error: Connection closed mid-response",
          pauseUntil: rig.clock + pauseMs,
          md: "bug-001.md",
        }),
      },
      (r) => {
        if (r.windows.length >= 1) throw stop; // leave the loop after one pause
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.pauseArgs[0].iso).toBe(new Date(resumeMs).toISOString());
    expect(rig.pauseArgs[0].reason).toContain("Netzabbruch");
    expect(rig.windows[0]).toBe(resumeMs - WED_18.getTime());
    expect(rig.windows[0]).not.toBe(EMPTY_PAUSE_MS);
  });

  it("req-038: a network-abort step logs as 'idle' with the reason, not a generic error", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
    const resumeMs = WED_18.getTime() + 3 * 60_000;
    await runOnce(
      { n: 0 },
      deps({
        runStep: async (): Promise<StepDecision> => ({
          kind: "network-abort",
          message: "Netzabbruch (Versuch 1/3): API Error: Connection closed mid-response",
          pauseUntil: resumeMs,
          md: "bug-001.md",
        }),
      }),
    );
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle"); // recognisable as waiting, not a failure
    expect(row.message).toContain("Netzabbruch");
  });

  it("a pass that blows up entirely pauses too", async () => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1)));
    // runForever logs the failed pass; keep the test output readable.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const stop = new Error("stop");
    const rig = pauseRig(
      {
        setRunningStep: async () => {
          throw new Error("Status-Store weg");
        },
      },
      (r) => {
        if (r.windows.length >= 1) throw stop;
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.windows).toEqual([EMPTY_PAUSE_MS]);
    quiet.mockRestore();
  });
});

// bug-022: the loop used to sleep a whole pause window in ONE go, so
// `pause_until` was merely the DISPLAY of the pause. After a `claude login`,
// clearing it in the database left the worker asleep for the remaining hours —
// and the start page, with no reason left to show, fell back to "Leerlauf —
// nichts zu tun" while two requirements sat in ready/. The stored window is now
// the SOURCE of the pause: the loop re-reads it between short slices.
describe("worker loop — laufende Pause lässt sich abbrechen (bug-022)", () => {
  const SIX_H = 6 * 60 * 60_000;

  beforeEach(() => {
    setStore(createMemoryStore([repos[0]]));
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
  });

  /** A step that always reports the expired login, i.e. a fresh 6-hour pause. */
  function authExpired(rig: () => PauseRig) {
    return async (): Promise<StepDecision> => ({
      kind: "auth-expired",
      message: "Anmeldung abgelaufen. Bitte `claude login` ausführen.",
      pauseUntil: rig().clock + SIX_H,
    });
  }

  it("AC: ein geleertes pause_until beendet die Pause — der Worker arbeitet weiter", async () => {
    const stop = new Error("stop");
    let steps = 0;
    let rig!: PauseRig;
    rig = pauseRig(
      {
        runStep: async () => {
          steps += 1;
          return authExpired(() => rig)();
        },
      },
      async (r) => {
        if (r.windows.length >= 1) throw stop; // a second pause: it ran again
        // The human is done with `claude login` and empties pause_until.
        if (r.slices.length === 1) await setPauseUntil(null);
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    // Back at work one slice later — not six hours later.
    expect(rig.windows[0]).toBe(PAUSE_POLL_MS);
    expect(rig.windows[0]).toBeLessThan(SIX_H);
    expect(steps).toBe(2); // the pass after the cleared pause really happened
  });

  it("AC: solange er pausiert, sagt die Anzeige „Pause“ — nicht „nichts zu tun“", async () => {
    const stop = new Error("stop");
    const phases: string[] = [];
    let rig!: PauseRig;
    rig = pauseRig(
      { runStep: async () => authExpired(() => rig)() },
      async (r) => {
        if (r.windows.length >= 1) throw stop;
        // What the start page would derive at this very moment (req-005).
        const status = await getWorkerStatusStore().get();
        phases.push(derivePhase(true, status, new Date(r.clock)));
        if (r.slices.length === 3) await setPauseUntil(null);
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    // Every moment of the sleep was a visible pause; the display never had to
    // guess "Leerlauf", because the worker sleeps exactly as long as the stored
    // window says it does.
    expect(phases).toEqual(["pause", "pause", "pause"]);
    expect(rig.windows[0]).toBe(3 * PAUSE_POLL_MS);
  });

  it("AC: Hauptschalter während der Pause aus und wieder an — der Worker bemerkt es", async () => {
    const stop = new Error("stop");
    let rig!: PauseRig;
    rig = pauseRig(
      { runStep: async () => authExpired(() => rig)() },
      async (r) => {
        if (r.windows.length >= 1) throw stop;
        if (r.slices.length === 1) await setWorkerEnabled(false);
        if (r.slices.length === 2) await setWorkerEnabled(true);
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    // Off alone keeps waiting; on again ends the wait right there.
    expect(rig.windows[0]).toBe(2 * PAUSE_POLL_MS);
  });

  it("die eigene Schreiberei zählt nicht als Eingriff — eine unangetastete Pause wird ausgesessen", async () => {
    const stop = new Error("stop");
    let rig!: PauseRig;
    rig = pauseRig({ runStep: async () => authExpired(() => rig)() }, (r) => {
      if (r.windows.length >= 1) throw stop;
    });
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.windows[0]).toBe(SIX_H); // the full six hours, just in slices
    expect(Math.max(...rig.slices)).toBe(PAUSE_POLL_MS); // sliced, not one nap
  });

  it("ein Fehler beim Nachsehen kürzt die Pause nicht ab", async () => {
    const stop = new Error("stop");
    const THREE_MIN = 3 * 60_000;
    let looks = 0;
    let rig!: PauseRig;
    rig = pauseRig(
      {
        runStep: async (): Promise<StepDecision> => ({
          kind: "network-abort",
          message: "Netzabbruch (Versuch 1/3)",
          pauseUntil: rig.clock + THREE_MIN,
        }),
        getPauseUntil: async () => {
          looks += 1;
          if (looks <= 2) throw new Error("Status-Store weg");
          return (await getWorkerStatusStore().get()).pauseUntil;
        },
      },
      (r) => {
        if (r.windows.length >= 1) throw stop;
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.windows[0]).toBe(THREE_MIN); // unreadable == unchanged
  });

  it("eine vom Menschen gesetzte Pause überschreibt der Worker nicht", async () => {
    const stop = new Error("stop");
    let rig!: PauseRig;
    rig = pauseRig(
      { runStep: async () => authExpired(() => rig)() },
      async (r) => {
        if (r.windows.length >= 1) throw stop;
        // Not cleared but moved: someone wants a different window. The worker
        // ends ITS wait — and leaves that value alone instead of nulling it.
        if (r.slices.length === 1) {
          await setPauseUntil(new Date(r.clock + 30 * 60_000).toISOString(), "Pause bis");
        }
      },
    );
    await expect(runForever(rig.deps)).rejects.toBe(stop);
    expect(rig.pauseArgs.map((a) => a.iso === null)).toEqual([false, false]);
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

// req-015: the Verlauf names the .md a run worked off. The loop is where that
// name becomes durable — it is written onto the log entry, not derived later.
describe("worker loop — .md am Verlaufs-Eintrag (req-015)", () => {
  beforeEach(() => {
    setStore(createMemoryStore([repos[0]]));
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
  });

  /** A step that always returns the same decision. */
  const step = (decision: StepDecision) => async () => decision;

  it("AC: the .md the step worked off is stored on its entry", async () => {
    await runOnce(
      { n: 0 },
      deps({
        runStep: step({
          kind: "success",
          message: "ok",
          md: "req-020-beispiel.md",
        }),
      }),
    );
    const [row] = await logStore.list(0, 1);
    expect(row.md).toBe("req-020-beispiel.md");
    expect(mdLabel(row)).toBe("req-020-beispiel.md");
  });

  it("AC: a recurring step is stored as such, not as a filename", async () => {
    await runOnce(
      { n: 0 },
      deps({ runStep: step({ kind: "success", message: "ok", md: RECURRING_MD }) }),
    );
    const [row] = await logStore.list(0, 1);
    expect(mdLabel(row)).toBe("wiederkehrende Aufgabe");
  });

  it("a failed step keeps the name of the .md it tried", async () => {
    await runOnce(
      { n: 0 },
      deps({
        runStep: step({ kind: "error", message: "Timeout", md: "bug-001.md" }),
      }),
    );
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("error");
    expect(row.md).toBe("bug-001.md");
  });

  it("a step that names no file leaves the entry without a second line", async () => {
    await runOnce(
      { n: 0 },
      deps({ runStep: step({ kind: "success", message: "ok" }) }),
    );
    const [row] = await logStore.list(0, 1);
    expect(row.md).toBeNull();
    expect(mdLabel(row)).toBeNull();
  });

  it("the 'nichts zu tun' row names no file — no step ran", async () => {
    setStore(createMemoryStore([{ ...repos[0], active: false }]));
    await runOnce({ n: 0 }, deps());
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
    expect(mdLabel(row)).toBeNull();
  });
});

// req-020: ein einzelnes Repo, das der Worker nicht vorbereiten kann, darf
// weder die übrigen Repos aufhalten noch unsichtbar bleiben — und eine Pause
// ohne jeden Verlaufs-Eintrag davor gibt es nicht mehr. Genau die war es, die
// aussah, als hätte der Worker einfach nichts zu tun.
describe("worker loop — kein wortloses Pausieren (req-020)", () => {
  beforeEach(() => {
    setTaskStore(createMemoryTaskStore(defaultTaskTypes().slice(0, 1))); // Bugs
  });

  it("AC: ein Repo, dessen Vorbereitung scheitert, steht im Verlauf — mit Repo und Grund", async () => {
    const runStep = async (repo: Repo): Promise<StepDecision> =>
      repo.name === "appbaua"
        ? {
            kind: "error",
            message:
              "Repo vorbereiten fehlgeschlagen (appbaua): Error: clone failed: not found",
          }
        : { kind: "success", message: "ok" };

    const done = await runOnce({ n: 0 }, deps({ runStep }));

    // AC: die übrigen Repos werden weiter bearbeitet
    expect(done.succeeded).toBe(1);
    const rows = [...(await logStore.list(0, 10))].reverse();
    expect(rows.map((r) => `${r.repo}:${r.status}`)).toEqual([
      "appbaua:error",
      "worker:success",
    ]);
    expect(rows[0].message).toContain("appbaua");
    expect(rows[0].message).toContain("clone failed");
  });

  it("AC: ein Durchlauf, der nichts erledigt hat, sagt das vor der Pause", async () => {
    // Vorher: geplante Schritte, die alle übersprungen wurden, schrieben gar
    // nichts — der Worker pausierte ohne erkennbaren Grund.
    const runStep = async (): Promise<StepDecision> => ({ kind: "skip" });

    const done = await runOnce({ n: 0 }, deps({ runStep }));

    expect(done.succeeded).toBe(0);
    expect(await logStore.count()).toBe(1);
    const [row] = await logStore.list(0, 1);
    expect(row.status).toBe("idle");
  });

  it("ein Durchlauf mit Einträgen braucht keine zusätzliche 'nichts zu tun'-Zeile", async () => {
    const runStep = async (): Promise<StepDecision> => ({
      kind: "error",
      message: "kaputt",
    });

    await runOnce({ n: 0 }, deps({ runStep }));

    const rows = await logStore.list(0, 10);
    expect(rows).toHaveLength(2); // beide Repos, keine idle-Zeile obendrauf
    expect(rows.every((r) => r.status === "error")).toBe(true);
  });
});
