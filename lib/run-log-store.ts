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

export type TodayMetrics = { done: number; errors: number };

export interface RunLogStore {
  append(entry: NewRunLogEntry): Promise<RunLogEntry>;
  /**
   * Record an idle ("Leerlauf") pass without flooding the log (req-029/req-021):
   * if the newest entry is already an idle-summary row, only its endedAt ("last
   * checked") moves forward; otherwise a fresh summary row is appended. Real work
   * in between is a normal entry and breaks the summary, so the next idle pass
   * starts a new one. Returns the row that now leads the log.
   */
  upsertIdle(entry: NewRunLogEntry): Promise<RunLogEntry>;
  /** Newest first, paginated. */
  list(offset: number, limit: number): Promise<RunLogEntry[]>;
  count(): Promise<number>;
  /** Completed steps (success+error) with startedAt >= sinceIso, and how many failed. */
  metricsSince(sinceIso: string): Promise<TodayMetrics>;
  /** The most recent 'error' entry, or null. */
  lastError(): Promise<RunLogEntry | null>;
  /**
   * Delete every log entry (req-007, manual "Verlauf-Log löschen"). Touches
   * only the log — repos, task types and worker status stay as they are, and
   * the automatic retention above is unaffected.
   */
  clear(): Promise<void>;
}

/** Marks the single collapsed idle-summary row (req-021). */
export function isIdleSummary(e: RunLogEntry): boolean {
  return e.status === "idle" && e.repo === null && e.taskType === null;
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
    async upsertIdle(entry) {
      const all = await readAll(); // oldest-first
      const last = all[all.length - 1];
      if (last && isIdleSummary(last)) {
        // Keep the run's start ("seit …"); move only the "last checked" end and
        // the message forward. Same id, so the Verlauf shows one growing row.
        const merged: RunLogEntry = {
          ...last,
          endedAt: entry.endedAt,
          message: entry.message,
        };
        all[all.length - 1] = merged;
        await writeAll(applyRetention(all, new Date(entry.endedAt)));
        return merged;
      }
      const nextId = all.length ? all[all.length - 1].id + 1 : 1;
      const full: RunLogEntry = { ...entry, id: nextId };
      await writeAll(applyRetention([...all, full], new Date(entry.endedAt)));
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
    async metricsSince(sinceIso) {
      const all = await readAll();
      return computeMetrics(all, sinceIso);
    },
    async lastError() {
      const all = await readAll();
      return findLastError(all);
    },
    async clear() {
      await writeAll([]);
    },
  };
}

function computeMetrics(
  entries: RunLogEntry[],
  sinceIso: string,
): { done: number; errors: number } {
  const since = new Date(sinceIso).getTime();
  const completed = entries.filter(
    (e) =>
      (e.status === "success" || e.status === "error") &&
      new Date(e.startedAt).getTime() >= since,
  );
  return {
    done: completed.length,
    errors: completed.filter((e) => e.status === "error").length,
  };
}

function findLastError(entries: RunLogEntry[]): RunLogEntry | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].status === "error") return entries[i];
  }
  return null;
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
    async upsertIdle(entry) {
      const last = entries[entries.length - 1];
      if (last && isIdleSummary(last)) {
        const merged: RunLogEntry = {
          ...last,
          endedAt: entry.endedAt,
          message: entry.message,
        };
        entries = applyRetention(
          [...entries.slice(0, -1), merged],
          new Date(entry.endedAt),
        );
        return merged;
      }
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
    async metricsSince(sinceIso) {
      return computeMetrics(entries, sinceIso);
    },
    async lastError() {
      return findLastError(entries);
    },
    async clear() {
      // Only the entries go; `seq` keeps counting so ids stay unique.
      entries = [];
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
