// Global worker on/off state (req-003). Same store-seam pattern as the other
// lists: file-backed for zero-infra dev, Postgres when configured, memory for
// tests. This only holds the desired state; the effect on a running worker is
// a separate concern (out of scope for req-003).

import { promises as fs } from "node:fs";
import path from "node:path";

export type WorkerState = { enabled: boolean };

export interface WorkerStateStore {
  get(): Promise<WorkerState>;
  set(state: WorkerState): Promise<WorkerState>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "worker-state.json");

export function createFileWorkerStore(): WorkerStateStore {
  return {
    async get() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return { enabled: parsed.enabled !== false };
      } catch {
        return { enabled: true }; // default: worker on
      }
    },
    async set(state) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(state, null, 2), "utf8");
      return state;
    },
  };
}

export function createMemoryWorkerStore(
  initial: WorkerState = { enabled: true },
): WorkerStateStore {
  let state = { ...initial };
  return {
    async get() {
      return { ...state };
    },
    async set(next) {
      state = { ...next };
      return { ...state };
    },
  };
}

function createDefaultWorkerStore(): WorkerStateStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgWorkerStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgWorkerStore();
  }
  return createFileWorkerStore();
}

let active: WorkerStateStore | null = null;

export function getWorkerStore(): WorkerStateStore {
  if (!active) active = createDefaultWorkerStore();
  return active;
}

export function setWorkerStore(store: WorkerStateStore): void {
  active = store;
}

export async function getWorkerState(): Promise<WorkerState> {
  return getWorkerStore().get();
}

export async function setWorkerEnabled(enabled: boolean): Promise<WorkerState> {
  return getWorkerStore().set({ enabled });
}
