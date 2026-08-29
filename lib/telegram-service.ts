// Die Naht zwischen Prüfrunde, Telegram und Verlauf (req-033).
//
// Zwei Richtungen laufen hier zusammen:
//  - hinaus: nach jeder Prüfrunde entscheidet planAlerts, was zu melden ist;
//    diese Datei verschickt es und merkt sich, was gemeldet wurde;
//  - herein: eine Nachricht aus dem zugelassenen Chat wird zu einem Befehl
//    (telegram-commands.ts) und beantwortet.
//
// Nichts davon darf die Überwachung anhalten. Ist Telegram nicht erreichbar,
// läuft die Prüfrunde normal weiter und der fehlgeschlagene Versand steht im
// Verlauf (req-033) — nicht in einer Warteschlange, die niemand sieht.

import type { AppHealth } from "./health";
import { getHealthStore } from "./health-store";
import { getRunLogStore } from "./run-log-store";
import { redact } from "./redact";
import {
  type Alert,
  type AlertState,
  alertKey,
  planAlerts,
} from "./telegram-alerts";
import {
  type CommandDeps,
  type PendingRestart,
  handleMessage,
} from "./telegram-commands";
import {
  type TelegramClient,
  type TelegramConfig,
  type TelegramUpdate,
  createTelegramClient,
  fromAllowedChat,
  readTelegramConfig,
} from "./telegram";

/** Was der Verlauf als "Task-Typ" zu einem gescheiterten Versand zeigt. */
export const TELEGRAM_LOG_LABEL = "Telegram";

export type NotifyDeps = {
  /** null, solange Bot-Schlüssel und Chat-Kennung fehlen. */
  client: TelegramClient | null;
  now: () => Date;
};

function defaultClient(): TelegramClient | null {
  const config = readTelegramConfig();
  return config ? createTelegramClient(config) : null;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Einen gescheiterten Versand im Verlauf festhalten. Best effort: schlägt auch
 * das fehl, ist das kein Grund, die Prüfrunde zu beenden.
 */
async function logFailedSend(
  alert: Alert,
  err: unknown,
  now: Date,
): Promise<void> {
  const at = now.toISOString();
  try {
    await getRunLogStore().append({
      startedAt: at,
      endedAt: at,
      repo: alert.repoName,
      taskType: TELEGRAM_LOG_LABEL,
      status: "error",
      message: redact(
        `Telegram-Nachricht nicht zugestellt (${alert.check}): ${messageOf(err)}`,
      ),
      md: null,
    });
  } catch {
    /* der Verlauf ist nicht der Zweck dieser Runde */
  }
}

/**
 * Nach einer Prüfrunde: melden, was zu melden ist, und sich merken, was gemeldet
 * wurde. Gibt die tatsächlich zugestellten Meldungen zurück.
 *
 * Der gemerkte Zustand wird IMMER fortgeschrieben — auch wenn die Meldungen in
 * den Einstellungen abgeschaltet sind oder gar kein Bot eingerichtet ist. Sonst
 * käme beim Einschalten eine Lawine alter Befunde.
 *
 * Nur der Vermerk "wurde gemeldet" wird zurückgenommen, wenn der Versand
 * scheiterte: dann versucht es die nächste Runde erneut, statt den Ausfall
 * stillschweigend zu verschlucken.
 */
export async function notifyAfterRound(
  results: AppHealth[],
  deps?: Partial<NotifyDeps>,
): Promise<Alert[]> {
  const now = deps?.now ?? (() => new Date());
  const client = deps?.client !== undefined ? deps.client : defaultClient();

  const store = getHealthStore();
  const [settings, before] = await Promise.all([
    store.getSettings(),
    store.getAlertState(),
  ]);
  const { alerts, state } = planAlerts(results, before);

  const silent = !settings.telegram || client === null;
  if (silent || alerts.length === 0) {
    await store.setAlertState(state);
    return [];
  }

  const sent: Alert[] = [];
  const next: AlertState = { ...state };
  for (const alert of alerts) {
    try {
      await client.send(alert.text);
      sent.push(alert);
    } catch (err) {
      const key = alertKey(alert.repoId, alert.check);
      const entry = next[key];
      // Zurück auf den Stand vor dieser Runde: gemeldet ist erst, was ankam.
      if (entry) {
        next[key] = { ...entry, alerted: before[key]?.alerted ?? false };
      }
      await logFailedSend(alert, err, now());
    }
  }
  await store.setAlertState(next);
  return sent;
}

// ---------------------------------------------------------------------------
// Nachrichten herein
// ---------------------------------------------------------------------------

export type UpdateDeps = CommandDeps & {
  client: TelegramClient;
  config: TelegramConfig;
};

/**
 * Eine eingegangene Nachricht abarbeiten. Kommt sie nicht aus dem hinterlegten
 * Chat, passiert NICHTS — keine Antwort, keine Ausführung (req-033). Der Bot ist
 * öffentlich ansprechbar, und eine Antwort wäre schon die Auskunft, dass hier
 * etwas zu holen ist.
 *
 * Gibt die offene Rückfrage zurück, die nach dieser Nachricht gilt.
 */
export async function handleUpdate(
  update: TelegramUpdate,
  pending: PendingRestart | null,
  deps: UpdateDeps,
): Promise<PendingRestart | null> {
  if (!fromAllowedChat(update, deps.config)) return pending;

  const outcome = await handleMessage(update.text, pending, deps);
  try {
    await deps.client.send(outcome.reply);
  } catch {
    // Die Antwort ging verloren; die Rückfrage bleibt trotzdem stehen, damit
    // ein "ja" nicht ins Leere läuft.
  }
  return outcome.pending;
}
