import { promises as fs } from "node:fs";
import path from "node:path";
import type { Repo } from "./repos";

// Persistence for the repo list.
//
// stack.md fixes PostgreSQL as the project database. Until the DB is wired up
// (needs a running server + DATABASE_URL), the app persists to a local JSON
// file under .data/ so it runs and is manually acceptable with zero infra —
// which req-001 requires ("sofort gespeichert ... auch nach Neuladen"). The
// RepoStore interface is the seam: a Postgres-backed implementation drops in
// behind it without touching callers.

export interface RepoStore {
  list(): Promise<Repo[]>;
  /** Replace the whole ordered list (order = priority). */
  replace(repos: Repo[]): Promise<Repo[]>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "repos.json");

export function createFileStore(): RepoStore {
  return {
    async list() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as Repo[]) : [];
      } catch {
        return [];
      }
    },
    async replace(repos) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(repos, null, 2), "utf8");
      return repos;
    },
  };
}

export function createMemoryStore(initial: Repo[] = []): RepoStore {
  let repos = [...initial];
  return {
    async list() {
      return [...repos];
    },
    async replace(next) {
      repos = [...next];
      return [...repos];
    },
  };
}

// The active store. Defaults to the file store; tests swap in a memory store.
let active: RepoStore = createFileStore();

export function getStore(): RepoStore {
  return active;
}

export function setStore(store: RepoStore): void {
  active = store;
}
