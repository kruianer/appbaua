import { promises as fs } from "node:fs";
import path from "node:path";
import { type TaskType, defaultTaskTypes } from "./task-types";

// Persistence for the task-type list (req-002). Same seam pattern as the repo
// store: file-backed for zero-infra dev, Postgres when DATABASE_URL/PGHOST is
// set, memory store for tests. On an empty store the five predefined types are
// seeded (in vision order) so the list is never empty.

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

function createDefaultTaskStore(): TaskTypeStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgTaskStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgTaskStore();
  }
  return createFileTaskStore();
}

let active: TaskTypeStore | null = null;

export function getTaskStore(): TaskTypeStore {
  if (!active) active = createDefaultTaskStore();
  return active;
}

export function setTaskStore(store: TaskTypeStore): void {
  active = store;
}
