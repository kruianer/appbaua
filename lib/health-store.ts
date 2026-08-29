import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppHealth } from "./health";
import {
  type HealthSettings,
  DEFAULT_HEALTH_SETTINGS,
  normalizeSettings,
} from "./health-settings";

// Persistence for the Zustandsübersicht (req-032). Same seam pattern as the
// other stores: file for zero-infra dev, Postgres when configured, memory for
// tests. Two blobs, one store — the last results and the settings are read
// together on every page load, so splitting them into two stores would only
// double the plumbing.

export interface HealthStore {
  getResults(): Promise<AppHealth[]>;
  setResults(rows: AppHealth[]): Promise<void>;
  getSettings(): Promise<HealthSettings>;
  setSettings(settings: HealthSettings): Promise<HealthSettings>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const RESULTS_FILE = path.join(DATA_DIR, "health-results.json");
const SETTINGS_FILE = path.join(DATA_DIR, "health-settings.json");

export function createFileHealthStore(): HealthStore {
  return {
    async getResults() {
      try {
        const parsed = JSON.parse(await fs.readFile(RESULTS_FILE, "utf8"));
        return Array.isArray(parsed) ? (parsed as AppHealth[]) : [];
      } catch {
        return [];
      }
    },
    async setResults(rows) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(RESULTS_FILE, JSON.stringify(rows, null, 2), "utf8");
    },
    async getSettings() {
      try {
        return normalizeSettings(
          JSON.parse(await fs.readFile(SETTINGS_FILE, "utf8")),
        );
      } catch {
        return { ...DEFAULT_HEALTH_SETTINGS };
      }
    },
    async setSettings(settings) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(
        SETTINGS_FILE,
        JSON.stringify(settings, null, 2),
        "utf8",
      );
      return settings;
    },
  };
}

export function createMemoryHealthStore(initial?: {
  results?: AppHealth[];
  settings?: HealthSettings;
}): HealthStore {
  let results = [...(initial?.results ?? [])];
  let settings = normalizeSettings(initial?.settings);
  return {
    async getResults() {
      return [...results];
    },
    async setResults(rows) {
      results = [...rows];
    },
    async getSettings() {
      return { ...settings, checks: { ...settings.checks } };
    },
    async setSettings(next) {
      settings = next;
      return { ...settings, checks: { ...settings.checks } };
    },
  };
}

function createDefaultHealthStore(): HealthStore {
  if (process.env.DATABASE_URL || process.env.PGHOST) {
    const { createPgHealthStore } =
      require("./pg-store") as typeof import("./pg-store");
    return createPgHealthStore();
  }
  return createFileHealthStore();
}

let active: HealthStore | null = null;

export function getHealthStore(): HealthStore {
  if (!active) active = createDefaultHealthStore();
  return active;
}

export function setHealthStore(store: HealthStore): void {
  active = store;
}
