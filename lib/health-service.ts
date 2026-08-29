import { listRepos } from "./repo-service";
import type { Repo } from "./repos";
import { type DockerClient, createDockerClient } from "./docker";
import {
  type AppHealth,
  type ContainerInfo,
  matchContainers,
  parseHealthMd,
  pendingHealth,
} from "./health";
import { type CheckDeps, roundIsDue, runRound } from "./health-checks";
import { type HealthSettings, normalizeSettings } from "./health-settings";
import { getHealthStore } from "./health-store";
import { fetchHealthMd } from "./health-md-source";
import { type HeartbeatView, readHeartbeatView } from "./heartbeat-service";
import { notifyAfterRound } from "./telegram-service";

// Anwendungsdienst der Zustandsübersicht (req-032). Die Routen bleiben dünn und
// rufen hierher; die Tests fassen diese Funktionen direkt an.

export type HealthOverview = {
  apps: AppHealth[];
  settings: HealthSettings;
  /** Der Herzschlag zum Wächter beim Hoster (req-034). */
  heartbeat: HeartbeatView;
};

function defaultDeps(): CheckDeps {
  return {
    docker: createDockerClient(),
    fetchImpl: fetch,
    readHealthMd: (repo) => fetchHealthMd(repo),
    now: () => new Date(),
  };
}

/**
 * Was die Zustandsseite anzeigt: je überwachtem Repo eine Karte, in der
 * Reihenfolge der Repo-Liste. Ein Repo ohne gespeichertes Ergebnis bekommt
 * seine Karte trotzdem — mit "noch nicht geprüft" statt einer leeren Seite
 * (req-032).
 *
 * Diese Funktion prüft NICHTS. Sie liest nur, was die letzte Runde hinterlegt
 * hat; das Anstoßen einer Runde ist ein eigener Schritt (runDueChecks).
 */
export async function readHealthOverview(): Promise<HealthOverview> {
  const store = getHealthStore();
  const [repos, stored, settings, heartbeat] = await Promise.all([
    listRepos(),
    store.getResults(),
    store.getSettings(),
    readHeartbeatView(),
  ]);
  const byId = new Map(stored.map((r) => [r.repoId, r]));
  const apps = repos
    .filter((r) => r.monitored)
    .map((repo) => {
      const hit = byId.get(repo.id);
      // Name und URL kommen immer aus der Repo-Liste: wurde ein Repo
      // umbenannt, soll die Karte nicht den alten Namen zeigen.
      return hit
        ? { ...hit, repoName: repo.name, repoUrl: repo.url }
        : pendingHealth(repo);
    });
  return { apps, settings, heartbeat };
}

/** Läuft gerade eine Runde? Zwei parallele Runden wären doppelte Arbeit. */
let roundRunning = false;

/**
 * Eine Prüfrunde, aber nur wenn etwas fällig ist. Gibt zurück, ob geprüft
 * wurde. Der Aufrufer (die Route) wartet nicht darauf: die Seite zeigt sofort
 * den letzten Stand, und das Ergebnis dieser Runde kommt mit der nächsten
 * Abfrage.
 */
export async function runDueChecks(deps?: Partial<CheckDeps>): Promise<boolean> {
  if (roundRunning) return false;
  roundRunning = true;
  try {
    const store = getHealthStore();
    const [repos, previous, settings] = await Promise.all([
      listRepos(),
      store.getResults(),
      store.getSettings(),
    ]);
    const full: CheckDeps = { ...defaultDeps(), ...deps };
    if (!roundIsDue(repos, previous, settings, full.now())) return false;
    const results = await runRound(repos, previous, settings, full);
    await store.setResults(results);
    // Erst speichern, dann melden (req-033): die Zustandsseite zeigt einen
    // Ausfall auch dann, wenn die Nachricht nicht durchkommt.
    await notifyAfterRound(results, { now: full.now }).catch(() => {
      /* eine gescheiterte Meldung darf die Überwachung nicht anhalten */
    });
    return true;
  } finally {
    roundRunning = false;
  }
}

export async function readHealthSettings(): Promise<HealthSettings> {
  return getHealthStore().getSettings();
}

export async function updateHealthSettings(raw: unknown): Promise<HealthSettings> {
  return getHealthStore().setSettings(normalizeSettings(raw));
}

export type RestartResult =
  | { ok: true; container: string }
  | { ok: false; error: string };

/**
 * Genau einen Container neu starten, auf ausdrücklichen Klick (req-032).
 *
 * Der Name wird gegen die Container GENAU DIESER App geprüft, bevor irgendetwas
 * passiert: die Route nimmt einen Namen vom Client entgegen, und der darf nicht
 * auf einen beliebigen Container des Rechners zeigen. Die übrigen Container der
 * App bleiben unberührt — es wird immer nur der eine angefasst.
 */
export async function restartAppContainer(
  repoId: string,
  containerName: string,
  deps?: { docker?: DockerClient; readHealthMd?: (repo: Repo) => Promise<string | null> },
): Promise<RestartResult> {
  const repos = await listRepos();
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) return { ok: false, error: "Repo nicht gefunden." };
  if (!repo.monitored) return { ok: false, error: "Repo wird nicht überwacht." };

  const docker = deps?.docker ?? createDockerClient();
  const read = deps?.readHealthMd ?? ((r: Repo) => fetchHealthMd(r));

  let containers;
  try {
    containers = await docker.list();
  } catch {
    return { ok: false, error: "Docker nicht erreichbar." };
  }

  const spec = parseHealthMd(await read(repo).catch(() => null));
  const mine = matchContainers(spec, repo.name, containers);
  const target = mine.find((c) => c.name === containerName);
  if (!target) {
    return { ok: false, error: `${containerName} gehört nicht zu ${repo.name}.` };
  }

  try {
    await docker.restart(target.id);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Neustart fehlgeschlagen.",
    };
  }
  return { ok: true, container: target.name };
}

/** Alle Container, die eine Karte zum Neustart anbieten darf. */
export function restartableContainers(app: AppHealth): ContainerInfo[] {
  const seen = new Set<string>();
  const out: ContainerInfo[] = [];
  for (const check of app.checks) {
    for (const c of check.containers ?? []) {
      if (!c.failing || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}
