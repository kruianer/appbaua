import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type NewRunLogEntry,
  type RunLogEntry,
  LOG_MAX_AGE_DAYS,
  LOG_MAX_ROWS,
} from "./run-log";

// Persistence for the worker run log (req-004). Same store-seam pattern as the
// other lists: file for zero-infra dev, Postgres when configured, memory for
// tests. Retention (> LOG_MAX_AGE_DAYS old OR > LOG_MAX_ROWS, oldest first) is
// applied on every append.

export interface RunLogStore {
  append(entry: NewRunLogEntry): Promise<RunLogEntry>;
  /** Newest first, paginated. */
  list(offset: number, limit: number): Promise<RunLogEntry[]>;
  count(): Promise<number>;
}

/** Drop entries older than the cutoff, then keep only the newest maxRows. */
export function applyRetention(
  entries: RunLogEntry[],
  now: Date,
  maxRows = LOG_MAX_ROWS,
  maxAgeDays = LOG_MAX_AGE_DAYS,
): RunLogEntry[] {
  const cutoff = now.getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const fresh = entries.filter(
    (e) => new Date(e.startedAt).getTime() >= cutoff,
  );
  // keep newest maxRows (entries are oldest-first here)
  if (fresh.length > maxRows) return fresh.slice(fresh.length - maxRows);
  return fresh;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "run-log.json");

export function createFileRunLogStore(): RunLogStore {
  async function readAll(): Promise<RunLogEntry[]> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as RunLogEntry[]) : [];
    } catch {
      return [];
    }
  }
  async function writeAll(entries: RunLogEntry[]): Promise<void> {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(entries, null, 2), "utf8");
  }
  return {
    async append(entry) {
      const all = await readAll(); // oldest-first
      const nextId = all.length ? all[all.length - 1].id + 1 : 1;
      const full: RunLogEntry = { ...entry, id: nextId };
      const pruned = applyRetention(
        [...all, full],
        new Date(entry.endedAt),
      );
      await writeAll(pruned);
      return full;
    },
    async list(offset, limit) {
      const all = await readAll();
      const newestFirst = [...all].reverse();
      return newestFirst.slice(offset, offset + limit);
    },
    async count() {
      return (await readAll()).length;
    },
  };
}

export function createMemoryRunLogStore(
  initial: RunLogEntry[] = [],
): RunLogStore {
  let entries = [...initial]; // oldest-first
  let seq = entries.length;
  return {
    async append(entry) {
      seq += 1;
      const full: RunLogEntry = { ...entry, id: seq };
      entries = applyRetention([...entries, full], new Date(entry.endedAt));
      return full;
    },
    async list(offset, limit) {
      return [...entries].reverse().slice(offset, offset + limit);
    },
    async count() {
      return entries.length;
    },
  };
}

function createDefaultRunLogStore(): RunLogStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgRunLogStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgRunLogStore();
  }
  return createFileRunLogStore();
}

let active: RunLogStore | null = null;

export function getRunLogStore(): RunLogStore {
  if (!active) active = createDefaultRunLogStore();
  return active;
}

export function setRunLogStore(store: RunLogStore): void {
  active = store;
}
