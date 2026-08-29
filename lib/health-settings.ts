// Wie oft geprüft wird, und was überhaupt geprüft wird (req-032). Pure helpers
// only — the persistence sits in health-store.ts.

import { type CheckKind, CHECK_KINDS } from "./health";

export type HealthSettings = {
  /** Abstand der laufenden Prüfungen in Minuten (Vorgabe 5). */
  intervalMinutes: number;
  /**
   * Eigener Abstand der KI-Prüfung in Stunden (Vorgabe 24). Getrennt, weil
   * jeder Aufruf beim KI-Anbieter Geld kostet (req-032).
   */
  aiIntervalHours: number;
  /** Jede Prüfart lässt sich ganz abschalten. */
  checks: Record<CheckKind, boolean>;
  /**
   * Meldet appbaua Ausfälle per Telegram (req-033)? Bewusst getrennt von den
   * Schaltern oben: die Meldungen lassen sich abschalten, ohne die Überwachung
   * selbst abzuschalten — die Zustandsseite zeigt einen Ausfall dann weiterhin,
   * es kommt nur keine Nachricht.
   */
  telegram: boolean;
};

export const DEFAULT_HEALTH_SETTINGS: HealthSettings = {
  intervalMinutes: 5,
  aiIntervalHours: 24,
  telegram: true,
  checks: {
    container: true,
    database: true,
    web: true,
    zigbee: true,
    ai: true,
  },
};

/** Untergrenzen: ein Intervall von 0 wäre Dauerlast, eines von 1 Minute reicht. */
export const MIN_INTERVAL_MINUTES = 1;
export const MIN_AI_INTERVAL_HOURS = 1;

function clampNumber(raw: unknown, min: number, fallback: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.round(n));
}

/**
 * Bring whatever was stored (or sent by a client) into shape. A field that is
 * missing or nonsense falls back to its default rather than switching a
 * Prüfart off by accident — an unnoticed off is exactly the silence req-032
 * exists to end.
 */
export function normalizeSettings(raw: unknown): HealthSettings {
  const input = (raw ?? {}) as Partial<HealthSettings>;
  const checks = { ...DEFAULT_HEALTH_SETTINGS.checks };
  const given = (input.checks ?? {}) as Partial<Record<CheckKind, unknown>>;
  for (const kind of CHECK_KINDS) {
    if (typeof given[kind] === "boolean") checks[kind] = given[kind] as boolean;
  }
  return {
    intervalMinutes: clampNumber(
      input.intervalMinutes,
      MIN_INTERVAL_MINUTES,
      DEFAULT_HEALTH_SETTINGS.intervalMinutes,
    ),
    aiIntervalHours: clampNumber(
      input.aiIntervalHours,
      MIN_AI_INTERVAL_HOURS,
      DEFAULT_HEALTH_SETTINGS.aiIntervalHours,
    ),
    // Wie bei den Prüfarten: nur ein ausdrückliches `false` schaltet ab. Ein
    // fehlendes Feld — etwa aus einem vor req-033 gespeicherten Stand — heißt
    // "wie vorgesehen", nicht "stumm".
    telegram:
      typeof input.telegram === "boolean"
        ? input.telegram
        : DEFAULT_HEALTH_SETTINGS.telegram,
    checks,
  };
}

/** Wie lange ein Ergebnis dieser Prüfart als frisch gilt, in Millisekunden. */
export function intervalMsFor(kind: CheckKind, settings: HealthSettings): number {
  return kind === "ai"
    ? settings.aiIntervalHours * 60 * 60 * 1000
    : settings.intervalMinutes * 60 * 1000;
}
