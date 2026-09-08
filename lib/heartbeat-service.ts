// Die Naht zwischen Herzschlag, Speicher und Verlauf (req-034).
//
// Der Takt läuft im Serverprozess der App mit (instrumentation.ts), unabhängig
// von den Schleifen aus req-033: der Wächter beim Hoster soll gerade dann noch
// bedient werden, wenn Telegram gar nicht eingerichtet ist.
//
// Ein gescheiterter Versand hält nichts auf. appbaua läuft normal weiter, der
// Versuch steht im Verlauf, und der nächste Takt versucht es erneut (req-034).

import {
  type HeartbeatConfig,
  type HeartbeatStatus,
  DEFAULT_HEARTBEAT_MINUTES,
  intervalMs,
  readHeartbeatConfig,
  sendHeartbeat,
} from "./heartbeat";
import { getHealthStore } from "./health-store";
import { getRunLogStore } from "./run-log-store";
import { redact } from "./redact";

/** Was der Verlauf als "Task-Typ" zu einem gescheiterten Herzschlag zeigt. */
export const HEARTBEAT_LOG_LABEL = "Herzschlag";

export type HeartbeatDeps = {
  /** null, solange Adresse oder Kennung des Wächters fehlen. */
  config: HeartbeatConfig | null;
  now: () => Date;
  fetchImpl: typeof fetch;
};

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Einen gescheiterten Versuch im Verlauf festhalten. Best effort: schlägt auch
 * das fehl, ist das kein Grund, den Takt zu beenden.
 */
async function logFailedBeat(message: string, now: Date): Promise<void> {
  const at = now.toISOString();
  try {
    await getRunLogStore().append({
      startedAt: at,
      endedAt: at,
      repo: null,
      taskType: HEARTBEAT_LOG_LABEL,
      status: "error",
      message: redact(`Herzschlag nicht zugestellt: ${message}`),
      md: null,
    });
  } catch {
    /* der Verlauf ist nicht der Zweck dieses Takts */
  }
}

/**
 * Einen Herzschlag senden und das Ergebnis merken. Gibt den neuen Stand zurück.
 *
 * In den Verlauf geht nur die ÄNDERUNG: der erste Fehlschlag einer Serie, nicht
 * jeder einzelne. Sonst stünden bei einem über Nacht abgeschalteten Hoster
 * hunderte gleichlautende Zeilen im Verlauf und verdeckten die eigentliche
 * Arbeit des Workers. Derselbe Grundsatz wie bei den Telegram-Meldungen
 * (req-033): gemeldet wird, was sich ändert.
 */
export async function sendHeartbeatNow(
  deps?: Partial<HeartbeatDeps>,
): Promise<HeartbeatStatus> {
  const now = deps?.now ?? (() => new Date());
  const fetchImpl = deps?.fetchImpl ?? fetch;
  const config = deps?.config !== undefined ? deps.config : readHeartbeatConfig();

  const store = getHealthStore();
  const before = await store.getHeartbeat();
  if (!config) return before;

  try {
    const acceptedAt = await sendHeartbeat(config, now(), fetchImpl);
    const next: HeartbeatStatus = { acceptedAt, error: null };
    await store.setHeartbeat(next);
    return next;
  } catch (err) {
    const message = redact(messageOf(err));
    const next: HeartbeatStatus = { acceptedAt: before.acceptedAt, error: message };
    await store.setHeartbeat(next);
    if (!before.error) await logFailedBeat(message, now());
    return next;
  }
}

/** Was die Zustandsseite über den Herzschlag zeigt (req-034). */
export type HeartbeatView = HeartbeatStatus & {
  /** false, solange kein Wächter hinterlegt ist. */
  configured: boolean;
  intervalMinutes: number;
};

export async function readHeartbeatView(
  config: HeartbeatConfig | null = readHeartbeatConfig(),
): Promise<HeartbeatView> {
  const status = await getHealthStore().getHeartbeat();
  return {
    ...status,
    configured: config !== null,
    intervalMinutes: config?.intervalMinutes ?? DEFAULT_HEARTBEAT_MINUTES,
  };
}

export type LoopDeps = {
  config: HeartbeatConfig;
  sleep: (ms: number) => Promise<void>;
  /** Solange true, läuft die Schleife weiter. Für Tests endlich. */
  keepGoing: () => boolean;
  beat?: () => Promise<unknown>;
};

/**
 * Der Herzschlag-Takt. Schlägt SOFORT beim Start einmal — nach einem Deploy
 * oder Neustart soll der Wächter nicht erst nach einem vollen Abstand wieder
 * hören, dass es den Rechner noch gibt (req-034: ein Neustart von 3 Minuten
 * darf keine Meldung auslösen).
 */
export async function runHeartbeatLoop(deps: LoopDeps): Promise<void> {
  const beat = deps.beat ?? (() => sendHeartbeatNow({ config: deps.config }));
  while (deps.keepGoing()) {
    try {
      await beat();
    } catch {
      /* ein gescheiterter Schlag beendet den Takt nicht */
    }
    await deps.sleep(intervalMs(deps.config));
  }
}

let started = false;

/**
 * Den Takt starten — einmal pro Prozess. Ohne hinterlegten Wächter passiert gar
 * nichts; appbaua verhält sich dann exakt wie vorher. Gibt zurück, ob gestartet
 * wurde.
 */
export function startHeartbeat(): boolean {
  if (started) return false;
  const config = readHeartbeatConfig();
  if (!config) return false;
  started = true;

  void runHeartbeatLoop({
    config,
    sleep: (ms) => new Promise<void>((r) => setTimeout(r, ms)),
    keepGoing: () => true,
  }).catch(() => {
    /* letztes Netz: der Prozess darf daran nicht sterben */
  });
  return true;
}
