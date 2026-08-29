// Der mitlaufende Teil von req-033: zwei Schleifen im Server-Prozess der App.
//
//  1. Prüftakt — stößt regelmäßig eine fällige Prüfrunde an. Ohne ihn liefe die
//     Überwachung nur, solange jemand die Zustandsseite offen hat; von einem
//     Ausfall soll man aber gerade dann erfahren, wenn man NICHT hinschaut.
//     Wie oft wirklich geprüft wird, entscheidet weiterhin der in den
//     Einstellungen gesetzte Abstand (req-032) — dieser Takt fragt nur nach.
//
//  2. Befehlstakt — hält per Long Polling eine Leitung zu Telegram offen und
//     beantwortet Nachrichten aus dem hinterlegten Chat.
//
// Beide sind bewusst unabhängig: ein hängender Telegram-Aufruf darf den
// Prüftakt nicht aufhalten und umgekehrt. Gestartet wird das Ganze einmal beim
// Hochfahren des Servers (instrumentation.ts) und nur dann, wenn Bot-Schlüssel
// und Chat-Kennung gesetzt sind.

import { readHealthOverview, restartAppContainer, runDueChecks } from "./health-service";
import {
  type TelegramClient,
  type TelegramConfig,
  createTelegramClient,
  nextOffset,
  readTelegramConfig,
} from "./telegram";
import type { CommandDeps, PendingRestart } from "./telegram-commands";
import { handleUpdate } from "./telegram-service";

/** Wie oft nachgefragt wird, ob eine Prüfung fällig ist. */
export const CHECK_TICK_MS = 60_000;

/** Wartezeit nach einem gescheiterten Abruf, damit ein Ausfall nicht rattert. */
export const POLL_BACKOFF_MS = 10_000;

export const commandDeps: CommandDeps = {
  readApps: async () => (await readHealthOverview()).apps,
  restart: (repoId, container) => restartAppContainer(repoId, container),
};

export type MonitorDeps = {
  client: TelegramClient;
  config: TelegramConfig;
  commands: CommandDeps;
  sleep: (ms: number) => Promise<void>;
  /** Solange true, läuft die jeweilige Schleife weiter. Für Tests endlich. */
  keepGoing: () => boolean;
};

/**
 * Ein Durchgang des Befehlstakts: abholen, abarbeiten, neuen Offset zurück.
 * `pending` ist die offene Rückfrage eines vorangegangenen `/neustart`.
 */
export async function pollUpdatesOnce(
  offset: number,
  pending: PendingRestart | null,
  deps: Pick<MonitorDeps, "client" | "config" | "commands">,
): Promise<{ offset: number; pending: PendingRestart | null }> {
  const updates = await deps.client.updates(offset);
  let current = pending;
  for (const update of updates) {
    current = await handleUpdate(update, current, {
      ...deps.commands,
      client: deps.client,
      config: deps.config,
    });
  }
  return { offset: nextOffset(updates, offset), pending: current };
}

/** Der Befehlstakt. Läuft, bis `keepGoing` false sagt (im Betrieb: nie). */
export async function runUpdateLoop(deps: MonitorDeps): Promise<void> {
  let offset = 0;
  let pending: PendingRestart | null = null;
  while (deps.keepGoing()) {
    try {
      const res = await pollUpdatesOnce(offset, pending, deps);
      offset = res.offset;
      pending = res.pending;
    } catch {
      // Telegram nicht erreichbar: kurz warten und weitermachen. Die
      // Überwachung selbst läuft davon unberührt weiter.
      await deps.sleep(POLL_BACKOFF_MS);
    }
  }
}

/** Der Prüftakt. */
export async function runCheckLoop(
  deps: Pick<MonitorDeps, "sleep" | "keepGoing"> & { tick?: () => Promise<unknown> },
): Promise<void> {
  const tick = deps.tick ?? (() => runDueChecks());
  while (deps.keepGoing()) {
    try {
      await tick();
    } catch {
      /* eine gescheiterte Runde beendet den Takt nicht */
    }
    await deps.sleep(CHECK_TICK_MS);
  }
}

let started = false;

/**
 * Beide Schleifen starten — einmal pro Prozess. Ohne hinterlegte Zugangsdaten
 * passiert gar nichts: dann ist die Telegram-Anbindung schlicht nicht
 * eingerichtet, und die Zustandsseite bleibt der einzige Weg zum Zustand.
 * Gibt zurück, ob gestartet wurde.
 */
export function startTelegramMonitor(): boolean {
  if (started) return false;
  const config = readTelegramConfig();
  if (!config) return false;
  started = true;

  const client = createTelegramClient(config);
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
  const deps: MonitorDeps = {
    client,
    config,
    commands: commandDeps,
    sleep,
    keepGoing: () => true,
  };

  void runCheckLoop(deps).catch(() => {
    /* letztes Netz: der Prozess darf daran nicht sterben */
  });
  void runUpdateLoop(deps).catch(() => {
    /* dito */
  });
  return true;
}
