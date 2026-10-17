// Domain type + pure helpers for die Container-Übersicht (req-042). No I/O
// here, same seam as lib/health.ts: the grouping rules are unit-testable on
// their own and shared between the service and its tests.

import type { Repo } from "./repos";
import { type DockerContainer, appTokens } from "./health";

export type ContainerStat = { memoryBytes: number; cpuPercent: number };

export type ContainerRow = {
  id: string;
  name: string;
  /** Docker's `State`: running, restarting, exited, … */
  state: string;
  /** Docker's human `Status`: "Up 3 hours", "Restarting (1) 5 seconds ago". */
  status: string;
  /** null solange kein Messwert vorliegt (nicht laufend, oder noch nicht gemessen). */
  memoryBytes: number | null;
  cpuPercent: number | null;
};

export type ContainerGroup = {
  key: string;
  label: string;
  containers: ContainerRow[];
  memoryBytesTotal: number;
};

export type ContainerOverview = {
  groups: ContainerGroup[];
};

const SONSTIGE_KEY = "sonstige";
const SONSTIGE_LABEL = "Sonstige";
const ENVS = ["dev", "prod"] as const;
type Env = (typeof ENVS)[number];

/**
 * "appbaua-prod" -> {app: "appbaua", env: "prod"}. Nur die zwei Umgebungen,
 * die dieser Standard kennt (stack.md) — alles andere ist kein Treffer.
 */
export function parseProjectEnv(project: string): { app: string; env: Env } | null {
  const m = project.match(/^(.+)-(dev|prod)$/i);
  if (!m) return null;
  return { app: m[1], env: m[2].toLowerCase() as Env };
}

/**
 * Welches eingetragene Repo zu diesem Compose-Projektnamen passt, falls
 * eines — über dieselben Namens-Token wie die Zustandsprüfung (req-032).
 */
function findRepoForApp(appSlug: string, repos: Repo[]): Repo | null {
  const lower = appSlug.toLowerCase();
  return repos.find((r) => appTokens(r.name).includes(lower)) ?? null;
}

function toRow(c: DockerContainer, stats: Map<string, ContainerStat>): ContainerRow {
  const s = stats.get(c.id) ?? null;
  return {
    id: c.id,
    name: c.name,
    state: c.state,
    status: c.status,
    memoryBytes: s?.memoryBytes ?? null,
    cpuPercent: s?.cpuPercent ?? null,
  };
}

function sumMemory(rows: ContainerRow[]): number {
  return rows.reduce((sum, r) => sum + (r.memoryBytes ?? 0), 0);
}

// ---------------------------------------------------------------------------
// Speicher und CPU
// ---------------------------------------------------------------------------

export type CpuSample = {
  cpuTotalUsage: number;
  cpuSystemUsage: number;
  onlineCpus: number;
};

/**
 * CPU-Last zwischen zwei Momentaufnahmen — siehe Constraint von req-042: eine
 * einzelne Messung reicht nicht, es braucht die Differenz zweier Messungen im
 * Abstand. Dieselbe Formel wie `docker stats`: welcher Anteil der seit der
 * letzten Messung vergangenen System-Zeit auf diesen Container entfiel.
 */
export function cpuPercentFromSamples(prev: CpuSample, curr: CpuSample): number {
  const cpuDelta = curr.cpuTotalUsage - prev.cpuTotalUsage;
  const systemDelta = curr.cpuSystemUsage - prev.cpuSystemUsage;
  if (systemDelta <= 0 || cpuDelta <= 0) return 0;
  const cpus = curr.onlineCpus || 1;
  return (cpuDelta / systemDelta) * cpus * 100;
}

export function formatMemory(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export function formatCpuPercent(percent: number): string {
  return `${percent.toFixed(1)} %`;
}

const STATE_LABELS: Record<string, string> = {
  running: "läuft",
  restarting: "startet neu",
  exited: "beendet",
  dead: "beendet",
  paused: "angehalten",
  created: "angelegt",
};

/** Docker's `State` auf Deutsch, in den Worten der Function-Beschreibung. */
export function containerStateLabel(state: string): string {
  return STATE_LABELS[state.toLowerCase()] ?? state;
}

const DURATION_DE: Record<string, string> = {
  second: "Sekunde",
  seconds: "Sekunden",
  minute: "Minute",
  minutes: "Minuten",
  hour: "Stunde",
  hours: "Stunden",
  day: "Tag",
  days: "Tage",
  week: "Woche",
  weeks: "Wochen",
  month: "Monat",
  months: "Monate",
};

/**
 * "Up 3 hours" -> "seit 3 Stunden"; "Restarting (1) 5 seconds ago" -> "seit 5
 * Sekunden". null, wenn der Status keine Dauer nennt (z.B. "Created").
 */
export function containerSince(status: string): string | null {
  const m = status.match(
    /(\d+)\s+(seconds|second|minutes|minute|hours|hour|days|day|weeks|week|months|month)/i,
  );
  if (!m) return null;
  const unit = DURATION_DE[m[2].toLowerCase()] ?? m[2];
  return `seit ${m[1]} ${unit}`;
}

/**
 * Container nach App und Umgebung gruppiert (req-042): "appbaua · dev" /
 * "appbaua · prod", Container ohne passendes Repo am Ende unter "Sonstige".
 *
 * Die Zuordnung kommt allein aus dem Compose-Projektnamen, NICHT aus
 * health.md — das ist eine andere Entscheidung (req-032). Ein Container, den
 * health.md von den Prüfungen ausnimmt (z.B. der Worker, siehe
 * delivery/health.md "Nicht prüfen"), gehört hier trotzdem zu seiner Gruppe:
 * genau sein Speicherverbrauch ist ja die Frage, die diese Ansicht beantwortet.
 */
export function buildContainerOverview(
  repos: Repo[],
  containers: DockerContainer[],
  stats: Map<string, ContainerStat>,
): ContainerOverview {
  const groups: ContainerGroup[] = [];
  const used = new Set<string>();

  for (const repo of repos) {
    for (const env of ENVS) {
      const rows = containers
        .filter((c) => {
          const parsed = parseProjectEnv(c.project);
          return (
            parsed !== null &&
            parsed.env === env &&
            findRepoForApp(parsed.app, repos)?.id === repo.id
          );
        })
        .map((c) => toRow(c, stats));
      if (rows.length === 0) continue;
      rows.forEach((r) => used.add(r.id));
      groups.push({
        key: `${repo.id}-${env}`,
        label: `${repo.name} · ${env}`,
        containers: rows,
        memoryBytesTotal: sumMemory(rows),
      });
    }
  }

  const rest = containers.filter((c) => !used.has(c.id)).map((c) => toRow(c, stats));
  if (rest.length > 0) {
    groups.push({
      key: SONSTIGE_KEY,
      label: SONSTIGE_LABEL,
      containers: rest,
      memoryBytesTotal: sumMemory(rest),
    });
  }

  return { groups };
}
