import { describe, it, expect, beforeEach } from "vitest";
import {
  createMemoryWorkerStore,
  getWorkerState,
  setWorkerEnabled,
  setWorkerStore,
} from "./worker-state";

beforeEach(() => {
  setWorkerStore(createMemoryWorkerStore());
});

// req-003 acceptance criteria.

describe("req-003 worker main switch", () => {
  it("AC: defaults to on", async () => {
    expect((await getWorkerState()).enabled).toBe(true);
  });

  it("AC: switching off persists as off", async () => {
    await setWorkerEnabled(false);
    expect((await getWorkerState()).enabled).toBe(false);
  });

  it("AC: switching back on persists as on", async () => {
    await setWorkerEnabled(false);
    await setWorkerEnabled(true);
    expect((await getWorkerState()).enabled).toBe(true);
  });
});
