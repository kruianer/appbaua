import { promises as fs } from "node:fs";
import path from "node:path";
import {
  type TaskType,
  defaultTaskTypes,
  withMissingDefaults,
} from "./task-types";

// Persistence for the task-type list (req-002). Same seam pattern as the repo
// store: file-backed for zero-infra dev, Postgres when DATABASE_URL/PGHOST is
// set, memory store for tests. On an empty store the predefined types are
// seeded (in vision order) so the list is never empty; a persisted list that
// predates a newly added type grows it back (req-014).

export interface TaskTypeStore {
  list(): Promise<TaskType[]>;
  replace(types: TaskType[]): Promise<TaskType[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "task-types.json");

export function createFileTaskStore(): TaskTypeStore {
  return {
    async list() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed as TaskType[];
        }
      } catch {
        // fall through to seed
      }
      const seeded = defaultTaskTypes();
      await this.replace(seeded);
      return seeded;
    },
    async replace(types) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(types, null, 2), "utf8");
      return types;
    },
  };
}

export function createMemoryTaskStore(initial?: TaskType[]): TaskTypeStore {
  let types = initial ? [...initial] : defaultTaskTypes();
  return {
    async list() {
      return types.map((t) => ({ ...t }));
    },
    async replace(next) {
      types = [...next];
      return types.map((t) => ({ ...t }));
    },
  };
}

/**
 * Wrap a persistent store so predefined types it does not know yet are added
 * and written back on the next read (req-014).
 *
 * Why a wrapper and not part of every store: the stores seed only an EMPTY
 * list, so an installation that ran before a type existed would never see it —
 * for the Security task that means it could never become due. The memory store
 * stays untouched on purpose; tests hand it exactly the list they want.
 */
export function seedMissingDefaults(store: TaskTypeStore): TaskTypeStore {
  return {
    async list() {
      const stored = await store.list();
      const merged = withMissingDefaults(stored);
      return merged === stored ? stored : store.replace(merged);
    },
    replace: (types) => store.replace(types),
  };
}

function createDefaultTaskStore(): TaskTypeStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgTaskStore } =
      require("./pg-store") as typeof import("./pg-store");
    return seedMissingDefaults(createPgTaskStore());
  }
  return seedMissingDefaults(createFileTaskStore());
}

let active: TaskTypeStore | null = null;

export function getTaskStore(): TaskTypeStore {
  if (!active) active = createDefaultTaskStore();
  return active;
}

export function setTaskStore(store: TaskTypeStore): void {
  active = store;
}
