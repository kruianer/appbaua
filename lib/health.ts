// Domain type + pure helpers for the Zustandsübersicht (req-032). No I/O here,
// so the whole "what does this health.md mean" question is unit-testable and
// shared between the checks, the API routes and the tests.
//
// Two vocabularies meet in this file and must not drift apart:
//  - req-032 names the Prüfarten Container, Datenbank, Web, Zigbee, KI;
//  - the `setup-health` skill writes the section that feeds the Zigbee check
//    under the heading `## Datenfluss`, because not every app's data comes
//    from Zigbee.
// The kind is called `zigbee`, its label says both, and the parser reads
// `## Datenfluss`.

import type { LogAnalysis } from "./log-analysis";

/** The five Prüfarten of req-032, in the order the card shows them. */
export const CHECK_KINDS = [
  "container",
  "database",
  "web",
  "zigbee",
  "ai",
] as const;

export type CheckKind = (typeof CHECK_KINDS)[number];

export const CHECK_LABELS: Record<CheckKind, string> = {
  container: "Container",
  database: "Datenbank",
  web: "Web",
  zigbee: "Datenfluss (Zigbee)",
  ai: "KI-Anbieter",
};

/**
 * What one Prüfung last said.
 *  - `ok`/`fail`  — it ran and gave an answer;
 *  - `unknown`    — it could not be carried out (no Docker, no key, no answer
 *                   at all). Different from `fail` on purpose: a check that
 *                   could not run has NOT found a problem;
 *  - `unconfigured` — the repo's health.md does not describe this Prüfart, so
 *                   there is nothing to check. req-032 asks for exactly this
 *                   instead of red ("appbaua rät nicht");
 *  - `off`        — switched off in den Einstellungen.
 */
export type CheckStatus = "ok" | "fail" | "unknown" | "unconfigured" | "off";

/** A container of the app as one check sees it. Carries the restart button. */
export type ContainerInfo = {
  /** Docker's own id, what a restart is addressed to. */
  id: string;
  name: string;
  /** Docker's `State`: running, restarting, exited, … */
  state: string;
  /** Docker's human `Status`: "Up 3 hours", "Restarting (1) 5 seconds ago". */
  status: string;
  /** True when THIS container is the reason the check is red. */
  failing: boolean;
};

export type CheckResult = {
  kind: CheckKind;
  status: CheckStatus;
  /** One line of plain German: what was checked and what came back. */
  detail: string;
  /** ISO timestamp of the last run, null while it has never run. */
  checkedAt: string | null;
  /** Containers this check is about — the restart buttons hang off these. */
  containers?: ContainerInfo[];
};

export type Lamp = "green" | "red" | "unknown";

export type AppHealth = {
  repoId: string;
  repoName: string;
  repoUrl: string;
  lamp: Lamp;
  checks: CheckResult[];
  /** Newest checkedAt across the checks, null while nothing has run. */
  checkedAt: string | null;
  /**
   * Was die KI der App zuletzt aus deren Logs gelesen hat (req-035). Wird beim
   * Lesen der Übersicht dazugelegt, nicht in der Prüfrunde geschrieben — eine
   * Analyse hat ihren eigenen, viel längeren Takt.
   */
  analysis?: LogAnalysis | null;
};

// ---------------------------------------------------------------------------
// health.md
// ---------------------------------------------------------------------------

/** Explicit `## Container` section — only used when the repo states one. */
export type ContainerSpec = {
  /** Compose project names (label com.docker.compose.project). */
  projects: string[];
  /** Container name prefixes. */
  prefixes: string[];
  /** Exact container names. */
  names: string[];
};

export type DatabaseSpec = {
  container: string;
  database: string;
  user: string;
};

export type WebSpec = {
  /** Environment the line names — "dev", "prod", … */
  env: string;
  url: string;
  /** Expected status as written, e.g. "307" or "2xx". */
  expect: string;
};

export type DataflowSpec = {
  description: string;
  /** "Woran erkennbar" — a URL, or a table/column description. */
  source: string;
  maxAgeMinutes: number;
};

export type AiSpec = {
  provider: string;
  /** NAME of the env var carrying the key — never the key itself. */
  keyEnv: string;
  /**
   * Optional: das Modell, das die Log-Analyse benutzen soll (req-035). Ohne
   * Angabe entscheidet appbaua (DEFAULT_ANALYSIS_MODELS) — die Kosten trägt
   * der Betreiber der App, also darf ihre health.md das überschreiben.
   */
  model?: string;
};

export type HealthSpec = {
  /** True when the repo has a health.md at all. */
  present: boolean;
  containers: ContainerSpec | null;
  database: DatabaseSpec | null;
  web: WebSpec[];
  dataflow: DataflowSpec | null;
  ai: AiSpec | null;
  /** Container names/prefixes from "Nicht prüfen" — skipped by every check. */
  ignore: string[];
};

export const EMPTY_SPEC: HealthSpec = {
  present: false,
  containers: null,
  database: null,
  web: [],
  dataflow: null,
  ai: null,
  ignore: [],
};

/**
 * Fold a heading or key to a comparison form: lowercase, umlauts spelled out,
 * everything that is not a letter or digit dropped. "Nicht prüfen" and
 * "NICHT PRUEFEN" then meet as "nichtpruefen", so the machine contract survives
 * the operator writing it either way.
 */
export function foldKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Strip the backticks the template puts around a value — but only when they
 * wrap the WHOLE value. "Tabelle `x`, Spalte `y`" keeps its inner backticks;
 * stripping the outer pair there would eat half of a real name.
 */
function unquote(raw: string): string {
  const text = raw.trim();
  const wrapped = text.match(/^([`'"])([\s\S]*)\1$/);
  return wrapped && !wrapped[2].includes(wrapped[1]) ? wrapped[2].trim() : text;
}

/** "- Key: value" -> [key, value]; anything else -> null. */
function bulletEntry(line: string): [string, string] | null {
  const m = line.match(/^\s*[-*]\s*(.+?)\s*:\s*(.*)$/);
  if (!m) return null;
  return [unquote(m[1]), m[2].trim()];
}

/** Every backticked token of a line, in order. */
function backticked(line: string): string[] {
  return [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1].trim());
}

const DURATION_UNITS: { pattern: RegExp; minutes: number }[] = [
  { pattern: /^(tag|tage|tagen|d|day|days)$/, minutes: 1440 },
  { pattern: /^(stunde|stunden|std|h|hour|hours)$/, minutes: 60 },
  { pattern: /^(minute|minuten|min|m|minutes)$/, minutes: 1 },
  { pattern: /^(sekunde|sekunden|sek|s|seconds)$/, minutes: 1 / 60 },
];

/**
 * "30 Minuten" -> 30, "2 Stunden" -> 120, "1 Tag" -> 1440. A bare number is
 * read as minutes — that is what the template's examples use. Returns null when
 * there is no number at all, so a garbled line leaves the Prüfung unconfigured
 * rather than silently checking against a made-up deadline.
 */
export function parseDurationMinutes(raw: string): number | null {
  const text = unquote(raw).toLowerCase();
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*([a-zäöüß]*)/);
  if (!m) return null;
  const value = Number(m[1].replace(",", "."));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = foldKey(m[2]);
  if (!unit) return value;
  const hit = DURATION_UNITS.find((u) => u.pattern.test(unit));
  return hit ? value * hit.minutes : value;
}

/**
 * Read the repo's `delivery/health.md`. A missing file (null) yields the empty
 * spec — req-032: only the checks that need no knowledge of the app then run,
 * and the rest report "nicht konfiguriert".
 */
export function parseHealthMd(text: string | null): HealthSpec {
  if (text === null || text.trim() === "") return { ...EMPTY_SPEC };

  const spec: HealthSpec = {
    present: true,
    containers: null,
    database: null,
    web: [],
    dataflow: null,
    ai: null,
    ignore: [],
  };

  let section = "";
  const db: Partial<DatabaseSpec> = {};
  const flow: Partial<DataflowSpec> & { maxAge?: number | null } = {};
  const ai: Partial<AiSpec> = {};
  const containers: ContainerSpec = { projects: [], prefixes: [], names: [] };
  let sawContainerSection = false;

  for (const line of text.split(/\r?\n/)) {
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (heading) {
      section = foldKey(heading[1]);
      if (section === "container") sawContainerSection = true;
      continue;
    }

    const entry = bulletEntry(line);

    if (section === "datenbank" && entry) {
      const [key, value] = entry;
      const k = foldKey(key);
      if (k === "container") db.container = unquote(value);
      else if (k === "datenbank" || k === "db") db.database = unquote(value);
      else if (k === "benutzer" || k === "user") db.user = unquote(value);
      continue;
    }

    if (section === "web" && entry) {
      const [env, rest] = entry;
      // "`https://dev…` erwartet `307`" — the expectation is optional; without
      // one, anything below 400 counts as healthy (see statusMatches).
      const parts = rest.split(/\s+erwartet\s+|\s+expects\s+/i);
      const url = unquote(parts[0]);
      if (!url) continue;
      spec.web.push({
        env: unquote(env),
        url,
        expect: parts.length > 1 ? unquote(parts.slice(1).join(" ")) : "",
      });
      continue;
    }

    if (section === "datenfluss" && entry) {
      const [key, value] = entry;
      const k = foldKey(key);
      if (k === "beschreibung") flow.description = unquote(value);
      else if (k === "woranerkennbar") flow.source = unquote(value);
      else if (k === "zualtab") flow.maxAge = parseDurationMinutes(value);
      continue;
    }

    if ((section === "kianbieter" || section === "ki") && entry) {
      const [key, value] = entry;
      const k = foldKey(key);
      if (k === "anbieter" || k === "provider") ai.provider = unquote(value).toLowerCase();
      else if (k === "schluesselaus" || k === "schluessel" || k === "key")
        ai.keyEnv = unquote(value);
      else if (k === "modell" || k === "model") ai.model = unquote(value);
      continue;
    }

    if (section === "container" && entry) {
      const [key, value] = entry;
      const k = foldKey(key);
      const values = value
        .split(",")
        .map(unquote)
        .filter(Boolean);
      if (k === "projekt" || k === "projekte" || k === "project")
        containers.projects.push(...values);
      else if (k === "praefix" || k === "prefix" || k === "praefixe")
        containers.prefixes.push(...values);
      else if (k === "name" || k === "namen" || k === "containers")
        containers.names.push(...values);
      continue;
    }

    if (section === "nichtpruefen") {
      // "- `lgt-cron-backup` — läuft nur nachts": the backticked token is the
      // container, the rest is the reason and none of appbaua's business.
      const quoted = backticked(line);
      if (quoted.length > 0) {
        spec.ignore.push(...quoted);
      } else {
        const bare = line.match(/^\s*[-*]\s*(\S+)/);
        if (bare) spec.ignore.push(unquote(bare[1]));
      }
      continue;
    }
  }

  if (db.container && db.database) {
    spec.database = {
      container: db.container,
      database: db.database,
      user: db.user ?? "postgres",
    };
  }
  if (flow.source && flow.maxAge) {
    spec.dataflow = {
      description: flow.description ?? "Datenfluss",
      source: flow.source,
      maxAgeMinutes: flow.maxAge,
    };
  }
  if (ai.provider && ai.keyEnv) {
    spec.ai = {
      provider: ai.provider,
      keyEnv: ai.keyEnv,
      ...(ai.model ? { model: ai.model } : {}),
    };
  }
  if (
    sawContainerSection &&
    (containers.projects.length || containers.prefixes.length || containers.names.length)
  ) {
    spec.containers = containers;
  }

  return spec;
}

// ---------------------------------------------------------------------------
// Which containers belong to an app
// ---------------------------------------------------------------------------

/** The shape the Docker client hands over — kept here so the matching is pure. */
export type DockerContainer = {
  id: string;
  /** Container name without Docker's leading slash. */
  name: string;
  state: string;
  status: string;
  /** com.docker.compose.project, or "" when the container is not from compose. */
  project: string;
};

/**
 * Names an app may go by, derived from its repo name: the name itself, and —
 * when it is written as several words — their initials. "LivingGardenTwin"
 * therefore also answers to "lgt", which is what its containers
 * (`lgt-prod-…`) are actually called.
 *
 * This is a heuristic and the only guess appbaua makes; a repo that does not
 * want to be guessed at writes a `## Container` section in its health.md and
 * the guess is skipped entirely (see matchContainers).
 */
export function appTokens(repoName: string): string[] {
  const words = repoName
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  const tokens = new Set<string>();
  const full = words.join("").toLowerCase();
  if (full.length >= 2) tokens.add(full);
  if (words.length >= 2) {
    const acronym = words.map((w) => w[0]).join("").toLowerCase();
    if (acronym.length >= 2) tokens.add(acronym);
  }
  return [...tokens];
}

/** Does `name` start with `token` as a whole segment ("lgt" in "lgt-prod-x")? */
function startsWithToken(name: string, token: string): boolean {
  const lower = name.toLowerCase();
  if (!lower.startsWith(token)) return false;
  return lower.length === token.length || /[^a-z0-9]/.test(lower[token.length]);
}

/** Should this container be left alone ("Nicht prüfen")? */
function isIgnored(container: DockerContainer, ignore: string[]): boolean {
  return ignore.some(
    (i) =>
      container.name.toLowerCase() === i.toLowerCase() ||
      startsWithToken(container.name, i.toLowerCase()),
  );
}

/**
 * The containers of one app. With an explicit `## Container` section only what
 * it names; otherwise everything whose compose project or name starts with one
 * of the app's tokens.
 */
export function matchContainers(
  spec: HealthSpec,
  repoName: string,
  containers: DockerContainer[],
): DockerContainer[] {
  const explicit = spec.containers;
  const tokens = explicit ? [] : appTokens(repoName);

  return containers.filter((c) => {
    if (isIgnored(c, spec.ignore)) return false;
    if (explicit) {
      return (
        explicit.names.some((n) => n.toLowerCase() === c.name.toLowerCase()) ||
        explicit.projects.some((p) => p.toLowerCase() === c.project.toLowerCase()) ||
        explicit.prefixes.some((p) => startsWithToken(c.name, p.toLowerCase()))
      );
    }
    return tokens.some(
      (t) => startsWithToken(c.name, t) || c.project.toLowerCase() === t,
    );
  });
}

/**
 * Is this container a problem? Anything other than a plainly running container
 * is — and a restart loop is the case req-032 calls out by name: Docker reports
 * it as state `restarting`, and its human status line says so too.
 */
export function isContainerFailing(c: DockerContainer): boolean {
  return c.state.toLowerCase() !== "running" || isRestartLoop(c);
}

export function isRestartLoop(c: DockerContainer): boolean {
  return (
    c.state.toLowerCase() === "restarting" ||
    /^restarting/i.test(c.status.trim())
  );
}

// ---------------------------------------------------------------------------
// Verdicts
// ---------------------------------------------------------------------------

/**
 * Does the answer match what the health.md expects? "307", "200, 307" and
 * "2xx" are all understood; without a usable expectation anything below 400
 * counts as healthy — a protected app answering 307 with its login redirect is
 * healthy, not broken (see the setup-health skill).
 */
export function statusMatches(actual: number, expect: string): boolean {
  const tokens = expect
    .toLowerCase()
    .split(/[,/\s]+|\boder\b|\bor\b/)
    .map((t) => t.trim())
    .filter(Boolean);
  const usable = tokens.filter((t) => /^\d{3}$/.test(t) || /^\dxx$/.test(t));
  if (usable.length === 0) return actual < 400;
  return usable.some((t) =>
    t.endsWith("xx")
      ? Math.floor(actual / 100) === Number(t[0])
      : actual === Number(t),
  );
}

/**
 * The app's Ampel. Red as soon as one Prüfung failed; green when at least one
 * gave a positive answer and none failed; unknown while nothing conclusive is
 * in — that is the "noch nicht geprüft" state right after a start.
 */
export function lampFor(checks: CheckResult[]): Lamp {
  if (checks.some((c) => c.status === "fail")) return "red";
  if (checks.some((c) => c.status === "ok")) return "green";
  return "unknown";
}

export const LAMP_LABELS: Record<Lamp, string> = {
  green: "läuft",
  red: "gestört",
  unknown: "noch nicht geprüft",
};

/** Newest checkedAt of a set of checks, or null when none has ever run. */
export function newestCheckedAt(checks: CheckResult[]): string | null {
  const stamps = checks
    .map((c) => c.checkedAt)
    .filter((s): s is string => Boolean(s))
    .sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

/** A check that has never run — what a fresh install shows. */
export function pendingCheck(kind: CheckKind): CheckResult {
  return { kind, status: "unknown", detail: "noch nicht geprüft", checkedAt: null };
}

/** The card of an app that has no stored result yet (req-032, letzte AC). */
export function pendingHealth(repo: {
  id: string;
  name: string;
  url: string;
}): AppHealth {
  const checks = CHECK_KINDS.map(pendingCheck);
  return {
    repoId: repo.id,
    repoName: repo.name,
    repoUrl: repo.url,
    lamp: "unknown",
    checks,
    checkedAt: null,
  };
}
