// Die KI-Log-Analyse (req-035), reine Logik: bereinigen, kürzen, fragen,
// Antwort deuten. Kein I/O — die Naht nach draußen (Docker, KI-Anbieter,
// Speicher, Verlauf) sitzt in log-analysis-service.ts.
//
// Zwei Dinge entscheiden hier über Brauchbarkeit und Kosten:
//  - was ÜBERHAUPT hinausgeht: Logs enthalten Zugangsdaten, Schlüssel und
//    personenbezogene Daten, und der Empfänger ist ein fremder Dienst;
//  - wie VIEL hinausgeht: ein Tageslog einer großen App passt in keinen Aufruf,
//    und jeder Aufruf kostet Geld.

import { redact } from "./redact";

/** Woher eine Analyse angestoßen wurde (req-035: drei Wege). */
export type AnalysisTrigger = "scheduled" | "failure" | "manual";

/**
 * Wie eine Analyse ausging.
 *  - `finding` — die KI hat etwas gefunden, das kein normaler Betrieb ist;
 *  - `clear`   — sie hat ausdrücklich nichts gefunden;
 *  - `error`   — sie konnte nicht laufen (kein Schlüssel, keine Antwort, keine
 *                verwertbare Antwort). Getrennt von `clear`, weil eine Analyse,
 *                die nicht lief, nichts festgestellt hat.
 */
export type AnalysisStatus = "finding" | "clear" | "error";

export type LogAnalysis = {
  repoId: string;
  /** ISO-Zeitstempel des Laufs. */
  at: string;
  trigger: AnalysisTrigger;
  status: AnalysisStatus;
  /** Der Text, der auf der Karte steht. */
  summary: string;
};

/** Was auf der Karte steht, wenn die KI nichts gefunden hat. */
export const NO_FINDING_TEXT = "keine Auffälligkeiten";

export const TRIGGER_LABELS: Record<AnalysisTrigger, string> = {
  scheduled: "regelmäßig",
  failure: "nach Ausfall",
  manual: "auf Knopfdruck",
};

/** Je Container so viele Logzeilen — mehr passt in keinen sinnvollen Aufruf. */
export const MAX_LOG_LINES = 200;

/** Und über alle Container zusammen höchstens so viele Zeichen. */
export const MAX_LOG_CHARS = 12_000;

/** So viele Container einer App werden gelesen. */
export const MAX_LOG_CONTAINERS = 5;

/** So lange wartet ein Aufruf beim KI-Anbieter auf Antwort. */
export const ANALYSIS_TIMEOUT_MS = 60_000;

/** Der gemerkte Stand: je Repo die letzte Analyse. */
export type AnalysisState = Record<string, LogAnalysis>;

const TRIGGERS: AnalysisTrigger[] = ["scheduled", "failure", "manual"];
const STATUSES: AnalysisStatus[] = ["finding", "clear", "error"];

/** Was JSON aus dem Speicher hergibt, in eine brauchbare Form. */
export function normalizeAnalyses(raw: unknown): AnalysisState {
  const out: AnalysisState = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = value as Partial<LogAnalysis> | null;
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.at !== "string" || typeof entry.summary !== "string") continue;
    out[key] = {
      repoId: typeof entry.repoId === "string" ? entry.repoId : key,
      at: entry.at,
      trigger: TRIGGERS.includes(entry.trigger as AnalysisTrigger)
        ? (entry.trigger as AnalysisTrigger)
        : "scheduled",
      status: STATUSES.includes(entry.status as AnalysisStatus)
        ? (entry.status as AnalysisStatus)
        : "error",
      summary: entry.summary,
    };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Was hinausgehen darf
// ---------------------------------------------------------------------------

/** Womit eine entfernte Angabe ersetzt wird. */
export const SCRUBBED = "***";

/**
 * Muster, die in Logs regelmäßig Geheimnisse oder personenbezogene Daten
 * tragen. Bewusst großzügig: ein zu viel entferntes Token kostet etwas Kontext,
 * ein zu wenig entferntes Token liegt bei einem fremden Anbieter.
 */
const SCRUB_RULES: [RegExp, string][] = [
  // "password=hunter2", "api_key: sk-…", "SECRET_TOKEN = abc"
  [
    /\b([A-Za-z_][\w.-]*(?:pass(?:wor[dt])?|passwd|secret|token|api[_-]?key|apikey|schluessel|credential|auth)[\w.-]*\s*[=:]\s*)("?)[^\s"',;)]+/gi,
    `$1$2${SCRUBBED}`,
  ],
  // Bearer-Token irgendwo im Text (nicht nur im Authorization-Header)
  [/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${SCRUBBED}`],
  // JSON Web Token
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, SCRUBBED],
  // Schlüssel der üblichen KI-Anbieter
  [/\bsk-[A-Za-z0-9_-]{16,}/g, SCRUBBED],
  // AWS
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, SCRUBBED],
  // E-Mail-Adressen — personenbezogen, und für einen Befund nie nötig
  [/\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/g, SCRUBBED],
];

/** Adressen des eigenen Netzes; sie sagen nichts über eine Person aus. */
function isPrivateIp(ip: string): boolean {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return false;
  }
  if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
  if (p[0] === 192 && p[1] === 168) return true;
  if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
  if (p[0] === 169 && p[1] === 254) return true;
  return false;
}

/**
 * Alles entfernen, was nicht bei einem fremden Anbieter landen soll: erst die
 * Geheimnisse, die dieser Prozess selbst kennt (redact, bug-003), dann die
 * Muster oben, zuletzt öffentliche IP-Adressen — die sind personenbezogen,
 * während die des eigenen Netzes stehen bleiben dürfen und beim Deuten helfen.
 */
export function scrubLogs(text: string): string {
  if (!text) return text;
  let out = redact(text);
  for (const [pattern, replacement] of SCRUB_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, (ip) =>
    isPrivateIp(ip) ? ip : SCRUBBED,
  );
}

/** Die letzten `max` Zeilen eines Logs — der jüngste Teil ist der wichtige. */
export function tailLines(text: string, max = MAX_LOG_LINES): string {
  const lines = text.replace(/\r/g, "").split("\n");
  return lines.slice(Math.max(0, lines.length - max)).join("\n").trim();
}

export type ContainerLog = { name: string; text: string };

/**
 * Die Logs aller Container einer App zu EINEM Text, bereinigt und begrenzt.
 * Wird es trotzdem zu lang, fällt der ÄLTESTE Teil weg und der Text sagt das —
 * eine stillschweigend halbierte Grundlage wäre schlimmer als eine sichtbar
 * gekürzte.
 */
export function buildLogBundle(
  logs: ContainerLog[],
  maxChars = MAX_LOG_CHARS,
): string {
  const parts = logs
    .map((l) => {
      const body = scrubLogs(tailLines(l.text));
      return body ? `--- ${l.name} ---\n${body}` : "";
    })
    .filter(Boolean);
  const joined = parts.join("\n\n");
  if (joined.length <= maxChars) return joined;
  return `[gekürzt — nur die jüngsten ${maxChars} Zeichen]\n${joined.slice(
    joined.length - maxChars,
  )}`;
}

// ---------------------------------------------------------------------------
// Die Frage an die KI
// ---------------------------------------------------------------------------

/**
 * Der Auftrag an die KI. Zwei Dinge stehen hier im Mittelpunkt, weil die
 * Meldungen sonst unbrauchbar werden (req-035):
 *  - der Unterschied zwischen "das ist normal" und "das ist ein Problem";
 *  - die ausdrückliche Erlaubnis, NICHTS gefunden zu haben.
 */
export const ANALYSIS_SYSTEM_PROMPT = [
  "Du siehst Logauszüge einer laufenden Anwendung durch und sagst in wenigen",
  "Sätzen, was auffällt. Antworte auf Deutsch.",
  "",
  "Als NORMAL gilt und ist KEIN Befund:",
  "- ein Neustart nach einem Deploy, samt der üblichen Startmeldungen;",
  "- eine einzelne fehlgeschlagene Anfrage oder ein einzelner Verbindungsabbruch;",
  "- eine Warnung, die durchgehend seit langem im Log steht;",
  "- gewöhnliche Zugriffs- und Debugmeldungen.",
  "",
  "Ein BEFUND ist, was den Betrieb gerade stört oder absehbar stören wird:",
  "wiederholte Abstürze oder Neustart-Schleifen, gehäufte Fehler derselben Art,",
  "erschöpfter Speicher oder Plattenplatz, abgelehnte Anmeldungen in Serie,",
  "abgebrochene Datenbankverbindungen.",
  "",
  "Findest du nichts davon, sage das ausdrücklich. Erfinde NIEMALS einen Befund,",
  "damit die Antwort nicht leer aussieht. Rate nicht über Dinge, die im Auszug",
  "nicht stehen.",
  "",
  'Antworte AUSSCHLIESSLICH mit JSON in dieser Form:',
  '{"befund": true oder false, "zusammenfassung": "..."}',
  "Die Zusammenfassung ist höchstens vier Sätze lang.",
].join("\n");

/** Der Text, der die Logs trägt. */
export function buildAnalysisPrompt(
  appName: string,
  bundle: string,
  opts?: { failure?: string | null },
): string {
  const head = [`App: ${appName}`];
  if (opts?.failure) {
    head.push(`Gemeldeter Ausfall: ${opts.failure}`);
  }
  return [
    ...head,
    "",
    "Logauszug (jüngste Zeilen, um Zugangsdaten bereinigt):",
    bundle,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Der Aufruf beim Anbieter der App
// ---------------------------------------------------------------------------

/**
 * Das Modell, das ohne ausdrückliche Angabe in der health.md benutzt wird. Die
 * health.md darf es je App überschreiben ("- Modell: ..."), denn die Kosten
 * trägt der Betreiber der jeweiligen App.
 */
export const DEFAULT_ANALYSIS_MODELS: Record<string, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4o-mini",
};

export type AnalysisRequest = { url: string; init: RequestInit };

/**
 * Der fertige Aufruf für den Anbieter der App, oder null wenn appbaua ihn nicht
 * kennt. Es wird bewusst NICHT geraten: ein unbekannter Anbieter führt zu einem
 * Fehlschlag im Verlauf, nicht zu einem Aufruf ins Blaue.
 */
export function buildAnalysisRequest(
  provider: string,
  key: string,
  model: string,
  prompt: string,
): AnalysisRequest | null {
  const json = { "Content-Type": "application/json" };
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      init: {
        method: "POST",
        headers: { ...json, "x-api-key": key, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          system: ANALYSIS_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        }),
      },
    };
  }
  if (provider === "openai") {
    return {
      url: "https://api.openai.com/v1/chat/completions",
      init: {
        method: "POST",
        headers: { ...json, Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          max_completion_tokens: 1024,
          messages: [
            { role: "system", content: ANALYSIS_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        }),
      },
    };
  }
  return null;
}

/** Den Antworttext aus der Hülle des jeweiligen Anbieters holen. */
export function extractReplyText(provider: string, payload: unknown): string | null {
  const data = payload as Record<string, unknown> | null;
  if (!data) return null;
  if (provider === "anthropic") {
    const blocks = data.content as { type?: string; text?: string }[] | undefined;
    const text = blocks?.find((b) => b.type === "text")?.text;
    return typeof text === "string" ? text : null;
  }
  if (provider === "openai") {
    const choices = data.choices as { message?: { content?: unknown } }[] | undefined;
    const text = choices?.[0]?.message?.content;
    return typeof text === "string" ? text : null;
  }
  return null;
}

export type ParsedAnalysis = { finding: boolean; summary: string };

/**
 * Die Antwort deuten. Erwartet wird JSON; ein Modell packt das gern in einen
 * Codeblock oder schreibt einen Satz davor, deshalb wird der erste
 * geschweifte Block gesucht.
 *
 * Ist nichts Verwertbares dabei, ist das ein Fehlschlag (null) — NICHT
 * "unauffällig". Ein nicht deutbarer Text darf nicht als Entwarnung durchgehen.
 */
export function parseAnalysisReply(text: string | null): ParsedAnalysis | null {
  if (!text) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return null;
  }
  const obj = parsed as Record<string, unknown> | null;
  if (!obj || typeof obj !== "object") return null;
  if (typeof obj.befund !== "boolean") return null;
  const summary =
    typeof obj.zusammenfassung === "string" ? obj.zusammenfassung.trim() : "";
  if (obj.befund && !summary) return null;
  return { finding: obj.befund, summary };
}

/**
 * Ist die regelmäßige Analyse wieder dran? Ohne bisherige Analyse: ja. Ein
 * Fehlschlag zählt wie ein Lauf — sonst liefe nach einem Ausfall des Anbieters
 * jede Runde erneut in denselben Fehler.
 */
export function analysisIsDue(
  previous: LogAnalysis | undefined,
  intervalHours: number,
  now: Date,
): boolean {
  if (!previous) return true;
  const at = new Date(previous.at).getTime();
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= intervalHours * 60 * 60 * 1000;
}
