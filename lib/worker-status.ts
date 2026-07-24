// Live worker status (req-005): the currently running step and/or the pause
// window. Written by the worker loop, read by the start page. Same store-seam
// pattern as the other lists.

import { promises as fs } from "node:fs";
import path from "node:path";

export type WorkerStatus = {
  currentRepo: string | null;
  currentType: string | null;
  stepStartedAt: string | null; // ISO
  pauseUntil: string | null; // ISO
};

export const EMPTY_STATUS: WorkerStatus = {
  currentRepo: null,
  currentType: null,
  stepStartedAt: null,
  pauseUntil: null,
};

export interface WorkerStatusStore {
  get(): Promise<WorkerStatus>;
  set(status: WorkerStatus): Promise<WorkerStatus>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "worker-status.json");

export function createFileWorkerStatusStore(): WorkerStatusStore {
  return {
    async get() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        return { ...EMPTY_STATUS, ...JSON.parse(raw) } as WorkerStatus;
      } catch {
        return { ...EMPTY_STATUS };
      }
    },
    async set(status) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(status, null, 2), "utf8");
      return status;
    },
  };
}

export function createMemoryWorkerStatusStore(
  initial: WorkerStatus = EMPTY_STATUS,
): WorkerStatusStore {
  let status = { ...initial };
  return {
    async get() {
      return { ...status };
    },
    async set(next) {
      status = { ...next };
      return { ...status };
    },
  };
}

function createDefaultWorkerStatusStore(): WorkerStatusStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgWorkerStatusStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgWorkerStatusStore();
  }
  return createFileWorkerStatusStore();
}

let active: WorkerStatusStore | null = null;

export function getWorkerStatusStore(): WorkerStatusStore {
  if (!active) active = createDefaultWorkerStatusStore();
  return active;
}

export function setWorkerStatusStore(store: WorkerStatusStore): void {
  active = store;
}

// Convenience mutators used by the worker loop.
export async function setRunningStep(
  repo: string,
  taskType: string,
  startedAt: string,
): Promise<void> {
  await getWorkerStatusStore().set({
    currentRepo: repo,
    currentType: taskType,
    stepStartedAt: startedAt,
    pauseUntil: null,
  });
}

export async function clearRunningStep(): Promise<void> {
  const s = await getWorkerStatusStore().get();
  await getWorkerStatusStore().set({ ...s, currentRepo: null, currentType: null, stepStartedAt: null });
}

export async function setPauseUntil(iso: string | null): Promise<void> {
  await getWorkerStatusStore().set({
    currentRepo: null,
    currentType: null,
    stepStartedAt: null,
    pauseUntil: iso,
  });
}
