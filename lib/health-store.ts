import { promises as fs } from "node:fs";
import path from "node:path";
import type { AppHealth } from "./health";
import {
  type HealthSettings,
  DEFAULT_HEALTH_SETTINGS,
  normalizeSettings,
} from "./health-settings";
import { type AlertState, normalizeAlertState } from "./telegram-alerts";
import {
  type HeartbeatStatus,
  EMPTY_HEARTBEAT_STATUS,
  normalizeHeartbeatStatus,
} from "./heartbeat";

// Persistence for the Zustandsübersicht (req-032). Same seam pattern as the
// other stores: file for zero-infra dev, Postgres when configured, memory for
// tests. Three blobs, one store — the last results and the settings are read
// together on every page load, so splitting them into separate stores would
// only double the plumbing.
//
// The third blob is the Telegram alert state (req-033): which check has failed
// how often in a row, and which failure has already been reported. It is kept
// next to the results rather than in memory because a restart of the app must
// not re-announce an outage that was reported hours ago.
//
// The fourth is the heartbeat (req-034): when the watchdog at the webhoster
// last accepted a beat, and why the last attempt failed. Same reason for
// persisting it: the Zustandsseite must show the real last contact after a
// restart, not "noch nie" for the first five minutes.

export interface HealthStore {
  getResults(): Promise<AppHealth[]>;
  setResults(rows: AppHealth[]): Promise<void>;
  getSettings(): Promise<HealthSettings>;
  setSettings(settings: HealthSettings): Promise<HealthSettings>;
  getAlertState(): Promise<AlertState>;
  setAlertState(state: AlertState): Promise<void>;
  getHeartbeat(): Promise<HeartbeatStatus>;
  setHeartbeat(status: HeartbeatStatus): Promise<void>;
}

const DATA_DIR = path.join(process.cwd(), ".data");
const RESULTS_FILE = path.join(DATA_DIR, "health-results.json");
const SETTINGS_FILE = path.join(DATA_DIR, "health-settings.json");
const ALERTS_FILE = path.join(DATA_DIR, "health-alerts.json");
const HEARTBEAT_FILE = path.join(DATA_DIR, "health-heartbeat.json");

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
    async getAlertState() {
      try {
        return normalizeAlertState(JSON.parse(await fs.readFile(ALERTS_FILE, "utf8")));
      } catch {
        return {};
      }
    },
    async setAlertState(state) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(ALERTS_FILE, JSON.stringify(state, null, 2), "utf8");
    },
    async getHeartbeat() {
      try {
        return normalizeHeartbeatStatus(
          JSON.parse(await fs.readFile(HEARTBEAT_FILE, "utf8")),
        );
      } catch {
        return { ...EMPTY_HEARTBEAT_STATUS };
      }
    },
    async setHeartbeat(status) {
      await fs.mkdir(DATA_DIR, { recursive: true });
      await fs.writeFile(HEARTBEAT_FILE, JSON.stringify(status, null, 2), "utf8");
    },
  };
}

export function createMemoryHealthStore(initial?: {
  results?: AppHealth[];
  settings?: HealthSettings;
  alerts?: AlertState;
  heartbeat?: HeartbeatStatus;
}): HealthStore {
  let results = [...(initial?.results ?? [])];
  let settings = normalizeSettings(initial?.settings);
  let alerts = normalizeAlertState(initial?.alerts);
  let heartbeat = normalizeHeartbeatStatus(initial?.heartbeat);
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
    async getAlertState() {
      return { ...alerts };
    },
    async setAlertState(next) {
      alerts = { ...next };
    },
    async getHeartbeat() {
      return { ...heartbeat };
    },
    async setHeartbeat(next) {
      heartbeat = { ...next };
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
