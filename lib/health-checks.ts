import type { Repo } from "./repos";
import type { DockerClient } from "./docker";
import {
  type AppHealth,
  type CheckKind,
  type CheckResult,
  type ContainerInfo,
  type DockerContainer,
  type HealthSpec,
  CHECK_KINDS,
  isContainerFailing,
  isRestartLoop,
  lampFor,
  matchContainers,
  newestCheckedAt,
  parseHealthMd,
  statusMatches,
} from "./health";
import { type HealthSettings, intervalMsFor } from "./health-settings";

// Die fünf Prüfungen aus req-032 und die Prüfrunde darüber. Alles, was nach
// draußen greift — Docker, HTTP, die health.md des Zielrepos, die Uhr — kommt
// als Abhängigkeit herein, damit jede Prüfung ohne laufende Fremdsysteme
// getestet werden kann.
//
// Grundsatz für den Ausgang jeder Prüfung: Rot heißt "geprüft und kaputt".
// Konnte eine Prüfung gar nicht laufen (kein Docker, kein Schlüssel), ist das
// "unbekannt" — sie hat nichts gefunden. Beschreibt die health.md sie nicht,
// ist das "nicht konfiguriert" — appbaua rät nicht (req-032).

export type CheckDeps = {
  docker: DockerClient;
  fetchImpl: typeof fetch;
  /** Liest `delivery/health.md` aus dem Zielrepo, oder null wenn es keine gibt. */
  readHealthMd: (repo: Repo) => Promise<string | null>;
  now: () => Date;
};

/** Wie lange eine Web-Prüfung auf Antwort wartet. */
export const WEB_TIMEOUT_MS = 8_000;

function toInfo(c: DockerContainer, failing: boolean): ContainerInfo {
  return { id: c.id, name: c.name, state: c.state, status: c.status, failing };
}

function result(
  kind: CheckKind,
  status: CheckResult["status"],
  detail: string,
  now: Date,
  containers?: ContainerInfo[],
): CheckResult {
  return {
    kind,
    status,
    detail,
    checkedAt: now.toISOString(),
    ...(containers && containers.length > 0 ? { containers } : {}),
  };
}

// ---------------------------------------------------------------------------
// Die einzelnen Prüfarten
// ---------------------------------------------------------------------------

/**
 * Laufen alle Container der App, und hängt keiner in einer Neustart-Schleife?
 * Die einzige Prüfung, die ohne Wissen über die App auskommt — sie läuft
 * deshalb auch für ein Repo ganz ohne health.md.
 */
export function containerCheck(
  spec: HealthSpec,
  repo: Repo,
  containers: DockerContainer[] | null,
  now: Date,
): CheckResult {
  if (containers === null) {
    return result("container", "unknown", "Docker nicht erreichbar", now);
  }
  const mine = matchContainers(spec, repo.name, containers);
  if (mine.length === 0) {
    // Nennt die health.md die Container ausdrücklich, ist ihr Fehlen ein
    // Befund. Wurden sie dagegen über den Namen der App erraten, ist das
    // Nichtfinden kein Befund, sondern eine Lücke — dann lieber "unbekannt".
    return spec.containers
      ? result(
          "container",
          "fail",
          "Keiner der in der health.md genannten Container existiert.",
          now,
        )
      : result(
          "container",
          "unknown",
          `Kein Container passt zum Namen "${repo.name}" — Abschnitt "## Container" in der health.md nennt sie ausdrücklich.`,
          now,
        );
  }

  const failing = mine.filter(isContainerFailing);
  const infos = mine.map((c) => toInfo(c, isContainerFailing(c)));
  if (failing.length === 0) {
    return result(
      "container",
      "ok",
      `${mine.length} ${mine.length === 1 ? "Container läuft" : "Container laufen"}`,
      now,
      infos,
    );
  }
  const named = failing
    .map((c) => `${c.name} (${isRestartLoop(c) ? "Neustart-Schleife" : c.state})`)
    .join(", ");
  return result("container", "fail", named, now, infos);
}

/** Antwortet die Datenbank auf eine einfache Abfrage? */
export async function databaseCheck(
  spec: HealthSpec,
  containers: DockerContainer[] | null,
  deps: CheckDeps,
  now: Date,
): Promise<CheckResult> {
  const db = spec.database;
  if (!db) {
    // Mit Zeitstempel, obwohl nichts geprüft wurde: die health.md WURDE
    // gelesen, sie beschreibt diese Prüfart nur nicht. Sonst gälte die Prüfart
    // dauerhaft als fällig und jede Abfrage der Seite stieße eine Runde an.
    return result(
      "database",
      "unconfigured",
      'kein Abschnitt "## Datenbank" in der health.md',
      now,
    );
  }
  if (containers === null) {
    return result("database", "unknown", "Docker nicht erreichbar", now);
  }
  const target = containers.find((c) => c.name === db.container);
  if (!target) {
    return result(
      "database",
      "fail",
      `Container ${db.container} existiert nicht`,
      now,
    );
  }
  try {
    const res = await deps.docker.exec(target.id, [
      "pg_isready",
      "-U",
      db.user,
      "-d",
      db.database,
    ]);
    const info = toInfo(target, res.exitCode !== 0);
    return res.exitCode === 0
      ? result("database", "ok", `${db.database} antwortet`, now, [info])
      : result(
          "database",
          "fail",
          res.output || `pg_isready endete mit Code ${res.exitCode}`,
          now,
          [info],
        );
  } catch (err) {
    return result("database", "unknown", messageOf(err), now);
  }
}

/** Antwortet die App unter ihrer öffentlichen Adresse? */
export async function webCheck(
  spec: HealthSpec,
  deps: CheckDeps,
  now: Date,
): Promise<CheckResult> {
  if (spec.web.length === 0) {
    return result(
      "web",
      "unconfigured",
      'kein Abschnitt "## Web" in der health.md',
      now,
    );
  }
  const parts: string[] = [];
  let failed = false;
  for (const entry of spec.web) {
    try {
      const res = await deps.fetchImpl(entry.url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
      });
      const good = statusMatches(res.status, entry.expect);
      if (!good) failed = true;
      parts.push(`${entry.env}: ${res.status}${good ? "" : " (unerwartet)"}`);
    } catch (err) {
      failed = true;
      parts.push(`${entry.env}: keine Antwort (${messageOf(err)})`);
    }
  }
  return result("web", failed ? "fail" : "ok", parts.join(" · "), now);
}

/** Der erste ISO-8601-Zeitstempel in einem Text, oder null. */
export function extractTimestamp(text: string): Date | null {
  const m = text.match(
    /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/,
  );
  if (!m) return null;
  const d = new Date(m[0].replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "Tabelle sensor_readings, Spalte recorded_at" oder "sensor_readings.recorded_at". */
export function parseTableColumn(
  source: string,
): { table: string; column: string } | null {
  const table = source.match(/tabelle\s+`?([a-z0-9_.]+)`?/i);
  const column = source.match(/spalte\s+`?([a-z0-9_]+)`?/i);
  if (table && column) return { table: table[1], column: column[1] };
  const dotted = source.match(/`?\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b`?/i);
  if (dotted) return { table: dotted[1], column: dotted[2] };
  return null;
}

/**
 * Ist der jüngste Datensatz jünger als die in der health.md genannte Frist?
 * Zwei Wege, je nachdem was unter "Woran erkennbar" steht: eine URL, die den
 * Zeitstempel nennt, oder eine Tabelle samt Spalte in der Datenbank der App.
 */
export async function zigbeeCheck(
  spec: HealthSpec,
  containers: DockerContainer[] | null,
  deps: CheckDeps,
  now: Date,
): Promise<CheckResult> {
  const flow = spec.dataflow;
  if (!flow) {
    return result(
      "zigbee",
      "unconfigured",
      'kein Abschnitt "## Datenfluss" in der health.md',
      now,
    );
  }

  let newest: Date | null = null;
  const url = flow.source.match(/https?:\/\/\S+/);
  if (url) {
    try {
      const res = await deps.fetchImpl(url[0], {
        signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
      });
      newest = extractTimestamp(await res.text());
    } catch (err) {
      return result("zigbee", "unknown", messageOf(err), now);
    }
    if (!newest) {
      return result("zigbee", "unknown", "Antwort nennt keinen Zeitstempel", now);
    }
  } else {
    const target = parseTableColumn(flow.source);
    if (!target) {
      return result(
        "zigbee",
        "unknown",
        '"Woran erkennbar" nennt weder eine URL noch Tabelle und Spalte',
        now,
      );
    }
    if (!spec.database) {
      return result(
        "zigbee",
        "unknown",
        "ohne Abschnitt \"## Datenbank\" nicht abfragbar",
        now,
      );
    }
    if (containers === null) {
      return result("zigbee", "unknown", "Docker nicht erreichbar", now);
    }
    const dbContainer = containers.find((c) => c.name === spec.database!.container);
    if (!dbContainer) {
      return result(
        "zigbee",
        "unknown",
        `Container ${spec.database.container} existiert nicht`,
        now,
      );
    }
    try {
      const res = await deps.docker.exec(dbContainer.id, [
        "psql",
        "-U",
        spec.database.user,
        "-d",
        spec.database.database,
        "-tAc",
        `SELECT MAX(${target.column}) FROM ${target.table}`,
      ]);
      if (res.exitCode !== 0) {
        return result("zigbee", "unknown", res.output || "Abfrage fehlgeschlagen", now);
      }
      newest = extractTimestamp(res.output);
    } catch (err) {
      return result("zigbee", "unknown", messageOf(err), now);
    }
    if (!newest) {
      return result("zigbee", "fail", "kein einziger Datensatz vorhanden", now);
    }
  }

  const ageMinutes = (now.getTime() - newest.getTime()) / 60_000;
  const rounded = Math.max(0, Math.round(ageMinutes));
  return ageMinutes > flow.maxAgeMinutes
    ? result(
        "zigbee",
        "fail",
        `jüngster Wert ${rounded} min alt (erlaubt: ${flow.maxAgeMinutes} min)`,
        now,
      )
    : result(
        "zigbee",
        "ok",
        `jüngster Wert ${rounded} min alt (erlaubt: ${flow.maxAgeMinutes} min)`,
        now,
      );
}

/** Wohin der Testaufruf des jeweiligen Anbieters geht. */
function aiProbe(
  provider: string,
  key: string,
): { url: string; headers: Record<string, string> } | null {
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/models",
      headers: { Authorization: `Bearer ${key}` },
    };
  }
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/models",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    };
  }
  return null;
}

/**
 * Antwortet der KI-Anbieter dieser App auf einen kleinen Testaufruf, mit dem
 * Schlüssel der App? Der Schlüssel kommt aus der Umgebung ihrer eigenen
 * Container — appbaua hält ihn nirgends selbst vor, die health.md nennt nur
 * seinen NAMEN.
 *
 * Abgefragt wird die Modell-Liste des Anbieters: sie beweist, dass Schlüssel
 * und Dienst tragen, ohne eine Generierung zu bezahlen. Trotzdem läuft diese
 * Prüfung auf ihrem eigenen, viel längeren Takt (Vorgabe 24 h, req-032).
 */
export async function aiCheck(
  spec: HealthSpec,
  containers: DockerContainer[] | null,
  repo: Repo,
  deps: CheckDeps,
  now: Date,
): Promise<CheckResult> {
  const ai = spec.ai;
  if (!ai) {
    return result(
      "ai",
      "unconfigured",
      'kein Abschnitt "## KI-Anbieter" in der health.md',
      now,
    );
  }
  if (containers === null) {
    return result("ai", "unknown", "Docker nicht erreichbar", now);
  }

  const mine = matchContainers(spec, repo.name, containers);
  let key = "";
  for (const c of mine) {
    try {
      const value = await deps.docker.env(c.id, ai.keyEnv);
      if (value) {
        key = value;
        break;
      }
    } catch {
      /* nächster Container */
    }
  }
  if (!key) {
    return result(
      "ai",
      "unknown",
      `${ai.keyEnv} in keinem Container der App gesetzt`,
      now,
    );
  }

  const probe = aiProbe(ai.provider, key);
  if (!probe) {
    return result("ai", "unknown", `Anbieter ${ai.provider} nicht unterstützt`, now);
  }
  try {
    const res = await deps.fetchImpl(probe.url, {
      headers: probe.headers,
      signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
    });
    return res.ok
      ? result("ai", "ok", `${ai.provider} antwortet`, now)
      : result("ai", "fail", `${ai.provider} antwortet mit ${res.status}`, now);
  } catch (err) {
    return result("ai", "fail", `${ai.provider}: ${messageOf(err)}`, now);
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------------------------------------------------------------------------
// Die Prüfrunde
// ---------------------------------------------------------------------------

/** Ergebnis dieser Prüfart aus der letzten Runde, oder undefined. */
function previousCheck(
  previous: AppHealth | undefined,
  kind: CheckKind,
): CheckResult | undefined {
  return previous?.checks.find((c) => c.kind === kind);
}

/**
 * Ist diese Prüfart wieder dran? Ein Ergebnis ohne Zeitstempel — noch nie
 * gelaufen, oder zuletzt abgeschaltet gewesen — ist immer fällig.
 */
export function isDue(
  prev: CheckResult | undefined,
  kind: CheckKind,
  settings: HealthSettings,
  now: Date,
): boolean {
  if (!prev || !prev.checkedAt) return true;
  const age = now.getTime() - new Date(prev.checkedAt).getTime();
  return age >= intervalMsFor(kind, settings);
}

const OFF_RESULT = (kind: CheckKind): CheckResult => ({
  kind,
  status: "off",
  detail: "in den Einstellungen abgeschaltet",
  checkedAt: null,
});

/**
 * Eine Prüfrunde über die überwachten Repos. Jede Prüfart läuft nur, wenn sie
 * eingeschaltet UND fällig ist; sonst bleibt das Ergebnis der letzten Runde
 * stehen. Eine abgeschaltete Prüfart wird nicht ausgeführt — die KI-Prüfung
 * macht dann also auch keinen Aufruf, der Geld kostet (req-032).
 *
 * Ein Repo, dessen Prüfung durchweg scheitert, darf die übrigen nicht
 * aufhalten: jede Prüfung fängt ihre eigenen Fehler ab und meldet sie als
 * "unbekannt".
 */
export async function runRound(
  repos: Repo[],
  previous: AppHealth[],
  settings: HealthSettings,
  deps: CheckDeps,
): Promise<AppHealth[]> {
  const now = deps.now();
  const byId = new Map(previous.map((p) => [p.repoId, p]));
  const out: AppHealth[] = [];

  for (const repo of repos.filter((r) => r.monitored)) {
    const prev = byId.get(repo.id);
    const due = CHECK_KINDS.filter(
      (kind) =>
        settings.checks[kind] && isDue(previousCheck(prev, kind), kind, settings, now),
    );

    const checks: CheckResult[] = [];
    if (due.length === 0) {
      for (const kind of CHECK_KINDS) {
        checks.push(
          settings.checks[kind]
            ? (previousCheck(prev, kind) ?? OFF_RESULT(kind))
            : OFF_RESULT(kind),
        );
      }
      out.push(assemble(repo, checks));
      continue;
    }

    const spec = parseHealthMd(await deps.readHealthMd(repo).catch(() => null));
    // Einmal auflisten und an alle Prüfungen dieser Runde weiterreichen.
    let containers: DockerContainer[] | null = null;
    try {
      containers = await deps.docker.list();
    } catch {
      containers = null;
    }

    for (const kind of CHECK_KINDS) {
      if (!settings.checks[kind]) {
        checks.push(OFF_RESULT(kind));
        continue;
      }
      if (!due.includes(kind)) {
        checks.push(previousCheck(prev, kind) ?? OFF_RESULT(kind));
        continue;
      }
      checks.push(await runOne(kind, spec, repo, containers, deps, now));
    }
    out.push(assemble(repo, checks));
  }

  return out;
}

async function runOne(
  kind: CheckKind,
  spec: HealthSpec,
  repo: Repo,
  containers: DockerContainer[] | null,
  deps: CheckDeps,
  now: Date,
): Promise<CheckResult> {
  try {
    switch (kind) {
      case "container":
        return containerCheck(spec, repo, containers, now);
      case "database":
        return await databaseCheck(spec, containers, deps, now);
      case "web":
        return await webCheck(spec, deps, now);
      case "zigbee":
        return await zigbeeCheck(spec, containers, deps, now);
      case "ai":
        return await aiCheck(spec, containers, repo, deps, now);
    }
  } catch (err) {
    return result(kind, "unknown", messageOf(err), now);
  }
}

function assemble(repo: Repo, checks: CheckResult[]): AppHealth {
  return {
    repoId: repo.id,
    repoName: repo.name,
    repoUrl: repo.url,
    lamp: lampFor(checks),
    checks,
    checkedAt: newestCheckedAt(checks),
  };
}

/**
 * Steht für irgendein überwachtes Repo eine Prüfart an? Die Route fragt das,
 * bevor sie eine Runde anstößt — ohne fällige Prüfung passiert gar nichts.
 */
export function roundIsDue(
  repos: Repo[],
  previous: AppHealth[],
  settings: HealthSettings,
  now: Date,
): boolean {
  const byId = new Map(previous.map((p) => [p.repoId, p]));
  return repos
    .filter((r) => r.monitored)
    .some((repo) =>
      CHECK_KINDS.some(
        (kind) =>
          settings.checks[kind] &&
          isDue(previousCheck(byId.get(repo.id), kind), kind, settings, now),
      ),
    );
}
