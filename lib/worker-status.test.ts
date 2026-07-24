import { describe, it, expect, beforeEach } from "vitest";
import {
  clearRunningStep,
  createMemoryWorkerStatusStore,
  getWorkerStatusStore,
  setCurrentMd,
  setCurrentOutput,
  setPauseUntil,
  setRunningStep,
  setWorkerStatusStore,
  type WorkerStatusStore,
} from "./worker-status";

// Live worker status (req-005) plus the step details added by req-008: which
// .md is being worked on and the tail of the running Claude output.

let store: WorkerStatusStore;
const startedAt = new Date(2026, 6, 24, 15, 0, 0).toISOString();

beforeEach(() => {
  store = createMemoryWorkerStatusStore();
  setWorkerStatusStore(store);
});

describe("worker status — step details (req-008)", () => {
  it("a fresh running step starts without .md and without output", async () => {
    await setRunningStep("appbaua", "Requirements", startedAt);
    const s = await getWorkerStatusStore().get();
    expect(s.currentRepo).toBe("appbaua");
    expect(s.currentMd).toBeNull();
    expect(s.currentOutput).toBeNull();
  });

  it("records the .md and the output tail of the running step", async () => {
    await setRunningStep("appbaua", "Requirements", startedAt);
    await setCurrentMd("req-042-beispiel.md");
    await setCurrentOutput("Zeile 1\nZeile 2");
    const s = await getWorkerStatusStore().get();
    expect(s.currentMd).toBe("req-042-beispiel.md");
    expect(s.currentOutput).toBe("Zeile 1\nZeile 2");
    expect(s.currentRepo).toBe("appbaua"); // step itself untouched
  });

  it("AC: ending the step drops the .md name and the live output", async () => {
    await setRunningStep("appbaua", "Requirements", startedAt);
    await setCurrentMd("req-042-beispiel.md");
    await setCurrentOutput("Zeile 1");
    await clearRunningStep();
    const s = await getWorkerStatusStore().get();
    expect(s.currentMd).toBeNull();
    expect(s.currentOutput).toBeNull();
    expect(s.stepStartedAt).toBeNull();
  });

  it("a late output write after the step ended is ignored", async () => {
    await setRunningStep("appbaua", "Requirements", startedAt);
    await clearRunningStep();
    await setCurrentOutput("verspaetet");
    await setCurrentMd("verspaetet.md");
    const s = await getWorkerStatusStore().get();
    expect(s.currentOutput).toBeNull();
    expect(s.currentMd).toBeNull();
    expect(s.currentRepo).toBeNull(); // and it does not resurrect the step
  });

  it("a pause window clears the step details as well", async () => {
    await setRunningStep("appbaua", "Requirements", startedAt);
    await setCurrentMd("req-042-beispiel.md");
    await setCurrentOutput("Zeile 1");
    await setPauseUntil(new Date(2026, 6, 24, 15, 5, 0).toISOString());
    const s = await getWorkerStatusStore().get();
    expect(s.currentMd).toBeNull();
    expect(s.currentOutput).toBeNull();
    expect(s.pauseUntil).not.toBeNull();
  });
});
