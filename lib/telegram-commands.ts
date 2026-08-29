// Die Befehle, die der Bot kennt (req-033): Status ansehen und einen Container
// neu starten. Mehr nicht — kein Deploy, kein Konfigurieren, kein Steuern des
// Workers über Telegram.
//
// Der Neustart trifft echte laufende Systeme, auch prod-Umgebungen fremder
// Apps. Deshalb passiert er nie auf den ersten Befehl hin: `/neustart` stellt
// eine Rückfrage, und erst eine ausdrückliche Bestätigung löst ihn aus.
// Schreibt der Nutzer stattdessen irgendetwas anderes, ist die Rückfrage
// gegenstandslos und es wird nichts neu gestartet.

import {
  type AppHealth,
  type CheckResult,
  type CheckStatus,
  CHECK_LABELS,
  LAMP_LABELS,
} from "./health";
import type { RestartResult } from "./health-service";

/** Zeitzone der Zeitangaben im Chat — ohne gesetzte TZ die des Betreibers. */
export const REPORT_TIME_ZONE = "Europe/Berlin";

/** "14:32" in der Zeitzone des Betreibers. */
export function hhmm(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "?";
  return d.toLocaleTimeString("de-DE", {
    timeZone: process.env.TZ || REPORT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LAMP_SYMBOL = { green: "🟢", red: "🔴", unknown: "⚪" } as const;

const STATUS_SYMBOL: Record<CheckStatus, string> = {
  ok: "🟢",
  fail: "🔴",
  unknown: "⚪",
  unconfigured: "⚪",
  off: "⚪",
};

const STATUS_TEXT: Record<CheckStatus, string> = {
  ok: "ok",
  fail: "Fehler",
  unknown: "unbekannt",
  unconfigured: "nicht konfiguriert",
  off: "abgeschaltet",
};

export const HELP_TEXT = [
  "Ich kenne:",
  "/status — Zustand aller überwachten Apps",
  "/status <App> — die einzelnen Prüfungen einer App",
  "/neustart <Container> — Container neu starten (mit Rückfrage)",
].join("\n");

// ---------------------------------------------------------------------------
// Befehl lesen
// ---------------------------------------------------------------------------

export type Command =
  | { kind: "status"; app: string | null }
  | { kind: "restart"; container: string }
  | { kind: "confirm" }
  | { kind: "unknown" };

/** Bestätigungen der Rückfrage. Alles andere gilt als Absage. */
const CONFIRM_WORDS = ["ja", "/ja", "bestätigen", "/bestätigen"];

/**
 * Was der Nutzer geschrieben hat. Telegram hängt in Gruppen ein `@botname` an
 * den Befehl — das wird abgeschnitten, damit `/status@meinbot` derselbe Befehl
 * ist wie `/status`.
 */
export function parseCommand(raw: string): Command {
  const text = raw.trim();
  if (CONFIRM_WORDS.includes(text.toLowerCase())) return { kind: "confirm" };

  const [head, ...rest] = text.split(/\s+/);
  const verb = head.toLowerCase().replace(/@.*$/, "");
  const argument = rest.join(" ").trim();

  if (verb === "/status") return { kind: "status", app: argument || null };
  if (verb === "/neustart") {
    return argument ? { kind: "restart", container: argument } : { kind: "unknown" };
  }
  return { kind: "unknown" };
}

// ---------------------------------------------------------------------------
// Antworten
// ---------------------------------------------------------------------------

/** Je überwachter App eine Zeile mit ihrem Zustand (req-033). */
export function formatOverview(apps: AppHealth[]): string {
  if (apps.length === 0) {
    return "Keine App wird überwacht. Schalte bei einem Repo den Schalter „überwachen“ ein.";
  }
  return apps
    .map((app) => `${LAMP_SYMBOL[app.lamp]} ${app.repoName} — ${LAMP_LABELS[app.lamp]}`)
    .join("\n");
}

function checkLine(check: CheckResult): string {
  const stamp = check.checkedAt ? ` (${hhmm(check.checkedAt)})` : "";
  return (
    `${STATUS_SYMBOL[check.status]} ${CHECK_LABELS[check.kind]}: ` +
    `${STATUS_TEXT[check.status]} — ${check.detail}${stamp}`
  );
}

/** Die einzelnen Prüfungen einer App. */
export function formatApp(app: AppHealth): string {
  return [
    `${LAMP_SYMBOL[app.lamp]} ${app.repoName} — ${LAMP_LABELS[app.lamp]}`,
    ...app.checks.map(checkLine),
  ].join("\n");
}

/**
 * Welche App gemeint ist. Erst der exakte Name, dann ein eindeutiger Anfang —
 * "/status living" soll reichen. Mehrdeutiges bleibt ungelöst, statt die
 * falsche App zu zeigen.
 */
export function findApp(apps: AppHealth[], name: string): AppHealth | null {
  const wanted = name.trim().toLowerCase();
  if (!wanted) return null;
  const exact = apps.find((a) => a.repoName.toLowerCase() === wanted);
  if (exact) return exact;
  const hits = apps.filter((a) => a.repoName.toLowerCase().startsWith(wanted));
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Zu welcher überwachten App dieser Container gehört. Gesucht wird in dem, was
 * die letzte Prüfrunde gesehen hat — genau wie auf der Zustandsseite, deren
 * Neustart-Knöpfe an denselben Containern hängen. Ein Container, den keine
 * überwachte App kennt, wird nicht neu gestartet.
 */
export function findContainerApp(
  apps: AppHealth[],
  container: string,
): AppHealth | null {
  const wanted = container.trim().toLowerCase();
  for (const app of apps) {
    for (const check of app.checks) {
      for (const c of check.containers ?? []) {
        if (c.name.toLowerCase() === wanted) return app;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Ausführen
// ---------------------------------------------------------------------------

/** Eine Rückfrage, auf deren Bestätigung gewartet wird. */
export type PendingRestart = { repoId: string; repoName: string; container: string };

export type CommandDeps = {
  readApps: () => Promise<AppHealth[]>;
  restart: (repoId: string, container: string) => Promise<RestartResult>;
};

export type CommandOutcome = {
  /** Was zurückgeschrieben wird. */
  reply: string;
  /** Die offene Rückfrage nach diesem Zug — null, wenn keine (mehr) offen ist. */
  pending: PendingRestart | null;
};

function confirmQuestion(pending: PendingRestart): string {
  return [
    `Soll ${pending.container} (${pending.repoName}) wirklich neu gestartet werden?`,
    "Antworte mit „ja“. Alles andere bricht ab.",
  ].join("\n");
}

/**
 * Eine Nachricht aus dem zugelassenen Chat abarbeiten. Der Aufrufer prüft
 * vorher, dass sie von dort kommt (telegram.ts: fromAllowedChat) — hier wird
 * nicht mehr gefragt, wer schreibt.
 *
 * `pending` ist die Rückfrage, die vor dieser Nachricht offen war. Nur eine
 * ausdrückliche Bestätigung führt sie aus; jede andere Nachricht verwirft sie
 * und wird danach ganz normal als Befehl gelesen.
 */
export async function handleMessage(
  text: string,
  pending: PendingRestart | null,
  deps: CommandDeps,
): Promise<CommandOutcome> {
  const command = parseCommand(text);

  if (pending) {
    if (command.kind === "confirm") {
      const res = await deps.restart(pending.repoId, pending.container);
      return {
        reply: res.ok
          ? `${res.container} wird neu gestartet.`
          : `Neustart fehlgeschlagen: ${res.error}`,
        pending: null,
      };
    }
    // Keine Bestätigung: die Rückfrage ist erledigt und es wurde NICHTS neu
    // gestartet. Die Nachricht selbst darf trotzdem ein Befehl sein.
    const cancelled = `Abgebrochen — ${pending.container} wurde nicht neu gestartet.`;
    const rest = await handleMessage(text, null, deps);
    return { reply: `${cancelled}\n\n${rest.reply}`, pending: rest.pending };
  }

  if (command.kind === "confirm") {
    return { reply: "Es steht keine Rückfrage offen.", pending: null };
  }

  if (command.kind === "status") {
    const apps = await deps.readApps();
    if (command.app === null) return { reply: formatOverview(apps), pending: null };
    const app = findApp(apps, command.app);
    return {
      reply: app
        ? formatApp(app)
        : `Keine überwachte App namens „${command.app}“.\n\n${formatOverview(apps)}`,
      pending: null,
    };
  }

  if (command.kind === "restart") {
    const apps = await deps.readApps();
    const app = findContainerApp(apps, command.container);
    if (!app) {
      return {
        reply: `${command.container} gehört zu keiner überwachten App.`,
        pending: null,
      };
    }
    const next: PendingRestart = {
      repoId: app.repoId,
      repoName: app.repoName,
      // Der Name aus der Prüfung, nicht der getippte: Groß-/Kleinschreibung
      // soll den Neustart nicht an der Namensprüfung scheitern lassen.
      container: containerNameOf(app, command.container),
    };
    return { reply: confirmQuestion(next), pending: next };
  }

  return { reply: HELP_TEXT, pending: null };
}

/** Der Container in seiner echten Schreibweise. */
function containerNameOf(app: AppHealth, typed: string): string {
  const wanted = typed.trim().toLowerCase();
  for (const check of app.checks) {
    for (const c of check.containers ?? []) {
      if (c.name.toLowerCase() === wanted) return c.name;
    }
  }
  return typed.trim();
}
