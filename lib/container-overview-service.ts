import { listRepos } from "./repo-service";
import { type ContainerStatsSample, type DockerClient, createDockerClient } from "./docker";
import type { DockerContainer } from "./health";
import {
  type ContainerOverview,
  type ContainerStat,
  buildContainerOverview,
  cpuPercentFromSamples,
} from "./container-overview";

// Anwendungsdienst der Container-Übersicht (req-042). Die Routen bleiben dünn
// und rufen hierher; die Tests fassen diese Funktionen direkt an.
//
// Dieselbe Form wie health-service.ts: eine Messrunde wird angestoßen, nicht
// abgewartet (Constraint: über fünfzig Container dauert sie spürbar, dazu
// kommt die erzwungene Pause zwischen den zwei CPU-Messungen). Gelesen wird
// immer der zuletzt gespeicherte Stand.

/** Abstand zwischen den zwei CPU-Messungen (Constraint: eine reicht nicht). */
export const STATS_SAMPLE_GAP_MS = 1000;

export type ContainerMeasureDeps = {
  docker: DockerClient;
  wait: (ms: number) => Promise<void>;
};

const defaultWait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Eine Momentaufnahme aller LAUFENDEN Container — nur die haben Messwerte. */
async function sampleRunning(
  containers: DockerContainer[],
  docker: DockerClient,
): Promise<Map<string, ContainerStatsSample>> {
  const running = containers.filter((c) => c.state.toLowerCase() === "running");
  const pairs = await Promise.all(
    running.map(async (c): Promise<[string, ContainerStatsSample | null]> => {
      try {
        return [c.id, await docker.stats(c.id)];
      } catch {
        // Ein Container, der zwischen `list` und `stats` verschwindet, oder ein
        // Agent, der nicht antwortet: dieser EINE Container bleibt unbemessen,
        // die Runde der anderen fällt deswegen nicht aus.
        return [c.id, null];
      }
    }),
  );
  return new Map(
    pairs.filter((p): p is [string, ContainerStatsSample] => p[1] !== null),
  );
}

/**
 * Speicher und CPU aller laufenden Container. CPU kommt aus der Differenz
 * ZWEIER Momentaufnahmen im Abstand (Constraint von req-042) — eine einzelne
 * sagt nichts über eine Last aus.
 */
export async function measureRunningContainers(
  containers: DockerContainer[],
  deps: ContainerMeasureDeps,
): Promise<Map<string, ContainerStat>> {
  const before = await sampleRunning(containers, deps.docker);
  await deps.wait(STATS_SAMPLE_GAP_MS);
  const after = await sampleRunning(containers, deps.docker);

  const stats = new Map<string, ContainerStat>();
  for (const [id, curr] of after) {
    const prev = before.get(id);
    if (!prev) continue;
    stats.set(id, {
      memoryBytes: curr.memoryBytes,
      cpuPercent: cpuPercentFromSamples(prev, curr),
    });
  }
  return stats;
}

type Snapshot = { containers: DockerContainer[]; stats: Map<string, ContainerStat> };

/** Der zuletzt gemessene Stand — null, solange noch keine Runde fertig ist. */
let lastSnapshot: Snapshot | null = null;
/** Läuft gerade eine Runde? Zwei parallele Runden wären doppelte Arbeit. */
let roundRunning = false;

/**
 * Eine Messrunde, aber nur wenn gerade keine läuft. Gibt zurück, ob gemessen
 * wurde. Der Aufrufer (die Route) wartet nicht darauf (req-042, wie req-032).
 */
export async function runContainerMeasurement(
  deps?: Partial<ContainerMeasureDeps>,
): Promise<boolean> {
  if (roundRunning) return false;
  roundRunning = true;
  try {
    const docker = deps?.docker ?? createDockerClient();
    const wait = deps?.wait ?? defaultWait;
    const containers = await docker.list();
    const stats = await measureRunningContainers(containers, { docker, wait });
    lastSnapshot = { containers, stats };
    return true;
  } finally {
    roundRunning = false;
  }
}

export type ContainerOverviewView = ContainerOverview & {
  /** True, solange noch keine einzige Messrunde durchgelaufen ist. */
  measuring: boolean;
};

/**
 * Was die Container-Übersicht anzeigt: der zuletzt gemessene Stand, gegen die
 * aktuelle Repo-Liste gruppiert. Prüft NICHTS selbst — das tut
 * runContainerMeasurement.
 */
export async function readContainerOverview(): Promise<ContainerOverviewView> {
  const repos = await listRepos();
  if (!lastSnapshot) return { groups: [], measuring: true };
  return {
    ...buildContainerOverview(repos, lastSnapshot.containers, lastSnapshot.stats),
    measuring: false,
  };
}

export type ContainerRestartResult =
  | { ok: true; container: string }
  | { ok: false; error: string };

/**
 * Genau einen Container neu starten, auf ausdrücklichen Klick (req-042, wie
 * req-032). Die Übersicht kennt die Container direkt von Docker — anders als
 * beim Neustart aus den Prüfungen (restartAppContainer) braucht es darum
 * keinen Umweg über health.md: der angefragte Name wird direkt gegen die
 * aktuelle Container-Liste geprüft, bevor irgendetwas passiert.
 */
export async function restartContainer(
  id: string,
  deps?: { docker?: DockerClient },
): Promise<ContainerRestartResult> {
  const docker = deps?.docker ?? createDockerClient();

  let containers: DockerContainer[];
  try {
    containers = await docker.list();
  } catch {
    return { ok: false, error: "Docker nicht erreichbar." };
  }

  const target = containers.find((c) => c.id === id);
  if (!target) return { ok: false, error: "Container nicht gefunden." };

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
