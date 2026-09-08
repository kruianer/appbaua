// Persistence for the network-abort retry counter (req-038). Keyed by
// `${repoName}::${md}` (see network-abort.ts), value = how many times in a row
// that package has just failed on a dropped connection. Must survive a worker
// restart — a rate limit or an expired login pause the whole loop, which
// keeps its state in memory across the pause, but a network-abort pause ends
// the loop's current pass and a restart of the container must not forget how
// many attempts a package already burned. Same store-seam pattern as the
// other lists: file-backed for zero-infra dev, Postgres when configured,
// memory for tests.

import { promises as fs } from "node:fs";
import path from "node:path";

export type NetworkAbortCounts = Record<string, number>;

export interface NetworkAbortStore {
  get(): Promise<NetworkAbortCounts>;
  set(counts: NetworkAbortCounts): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "network-abort-counts.json");

export function createFileNetworkAbortStore(): NetworkAbortStore {
  return {
    async get() {
      try {
        const parsed: unknown = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
        return parsed && typeof parsed === "object"
          ? (parsed as NetworkAbortCounts)
          : {};
      } catch {
        return {};
      }
    },
    async set(counts) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(counts, null, 2), "utf8");
    },
  };
}

export function createMemoryNetworkAbortStore(
  initial: NetworkAbortCounts = {},
): NetworkAbortStore {
  let counts = { ...initial };
  return {
    async get() {
      return { ...counts };
    },
    async set(next) {
      counts = { ...next };
    },
  };
}

function createDefaultNetworkAbortStore(): NetworkAbortStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgNetworkAbortStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgNetworkAbortStore();
  }
  return createFileNetworkAbortStore();
}

let active: NetworkAbortStore | null = null;

export function getNetworkAbortStore(): NetworkAbortStore {
  if (!active) active = createDefaultNetworkAbortStore();
  return active;
}

export function setNetworkAbortStore(store: NetworkAbortStore): void {
  active = store;
}
