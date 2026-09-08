// Domain type + retention constants for the worker run log (req-004).

import type { ErrorKind } from "./error-kind";

export type RunStatus = "success" | "error" | "idle";

export type RunLogEntry = {
  id: number;
  startedAt: string; // ISO
  endedAt: string; // ISO
  repo: string | null; // display name; null for idle rows
  taskType: string | null; // label; null for idle rows
  status: RunStatus;
  message: string;
  /**
   * The .md this run worked off (req-015). RECURRING_MD for types that have no
   * work item, and absent/null on entries written before req-015 — those never
   * recorded it, so the Verlauf shows no second line for them at all.
   */
  md?: string | null;
  /**
   * Die Art des Fehlers (req-037), abgeleitet aus `message`. Nur bei
   * status === "error" gesetzt; null/absent bei erfolgreichen Laeufen und bei
   * Eintraegen von vor req-037.
   *
   * Warum als eigenes Merkmal und nicht nur im Text: Um zu sehen, ob sich
   * Netzwerkfehler haeufen, musste man bisher im Text suchen — und wer sucht,
   * findet auch das Falsche. Die Fehlanalysen im September gingen genau darauf
   * zurueck.
   */
  errorKind?: ErrorKind | null;
  /**
   * Was unmittelbar nach dem Fehler gemessen wurde, als Freitext-Zeilen. Bei
   * einem Netzwerkfehler etwa, ob das Ziel danach erreichbar war und wie lange
   * der Verbindungsaufbau dauerte — damit im Nachhinein unterscheidbar ist, ob
   * die Stoerung anhielt oder ein einzelner Aussetzer war.
   */
  diagnostics?: string[] | null;
};

/** A row about to be written (no id yet). */
export type NewRunLogEntry = Omit<RunLogEntry, "id">;

/** Stored in `md` for a run of a task type that works off no .md (req-015). */
export const RECURRING_MD = "";

/** Shown in place of a filename for such a run (req-015). */
export const RECURRING_MD_LABEL = "wiederkehrende Aufgabe";

/**
 * The second line of a Verlauf entry (req-015): the .md name, the placeholder
 * for a recurring task, or null when the entry never recorded one — an entry
 * from before req-015 must not get a made-up label.
 */
export function mdLabel(entry: Pick<RunLogEntry, "md">): string | null {
  if (entry.md === undefined || entry.md === null) return null;
  return entry.md === RECURRING_MD ? RECURRING_MD_LABEL : entry.md;
}

export const LOG_MAX_ROWS = 1_000_000;
export const LOG_MAX_AGE_DAYS = 365;
export const LOG_PAGE_SIZE = 50;
