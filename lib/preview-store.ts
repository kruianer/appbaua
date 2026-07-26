import { promises as fs } from "node:fs";
import path from "node:path";
import type { PreviewRow } from "./preview";

// Persistence for the "Nächste Aktivitäten" preview (req-022). Same seam
// pattern as the other stores: file for zero-infra dev, Postgres when
// configured, memory for tests. The worker loop writes it after every pass;
// the Aktivität tab only ever reads it — never triggers a rebuild itself.

export interface PreviewStore {
  get(): Promise<PreviewRow[]>;
  set(rows: PreviewRow[]): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DATA_FILE = path.join(DATA_DIR, "preview.json");

export function createFilePreviewStore(): PreviewStore {
  return {
    async get() {
      try {
        const raw = await fs.readFile(DATA_FILE, "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? (parsed as PreviewRow[]) : [];
      } catch {
        return [];
      }
    },
    async set(rows) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(DATA_FILE, JSON.stringify(rows, null, 2), "utf8");
    },
  };
}

export function createMemoryPreviewStore(
  initial: PreviewRow[] = [],
): PreviewStore {
  let rows = [...initial];
  return {
    async get() {
      return [...rows];
    },
    async set(next) {
      rows = [...next];
    },
  };
}

function createDefaultPreviewStore(): PreviewStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgPreviewStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgPreviewStore();
  }
  return createFilePreviewStore();
}

let active: PreviewStore | null = null;

export function getPreviewStore(): PreviewStore {
  if (!active) active = createDefaultPreviewStore();
  return active;
}

export function setPreviewStore(store: PreviewStore): void {
  active = store;
}
