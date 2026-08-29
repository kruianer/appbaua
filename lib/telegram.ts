// Der Draht zu Telegram (req-033): Zugangsdaten aus der Umgebung, Nachrichten
// hinaus, Nachrichten herein. Nur Transport — WAS gemeldet wird, entscheidet
// telegram-alerts.ts, WAS auf einen Befehl passiert, telegram-commands.ts.
//
// Ein Telegram-Bot ist öffentlich ansprechbar: jeder, der seinen Namen kennt,
// kann ihm schreiben. Der ganze Schutz liegt darin, dass nur die hinterlegte
// Chat-Kennung akzeptiert wird (req-033). Deshalb steht der Vergleich hier
// unten in `fromAllowedChat` und nicht verstreut in den Aufrufern — es gibt
// genau eine Stelle, an der eine fremde Nachricht durchkäme.

/** Bot-Schlüssel und zugelassene Chat-Kennung. Beides nur aus der Umgebung. */
export type TelegramConfig = {
  botToken: string;
  /** Der EINE Chat, aus dem Befehle angenommen und in den gemeldet wird. */
  chatId: string;
};

/** Wie lange ein getUpdates-Aufruf auf eine Nachricht wartet (Long Polling). */
export const UPDATE_TIMEOUT_SECONDS = 30;

/** Obergrenze für einen einzelnen Aufruf an die Bot-API. */
export const TELEGRAM_TIMEOUT_MS = (UPDATE_TIMEOUT_SECONDS + 15) * 1000;

/**
 * Die Zugangsdaten, oder null wenn sie fehlen. Fehlen sie, ist die
 * Telegram-Anbindung schlicht nicht eingerichtet: appbaua meldet dann nichts
 * und nimmt nichts entgegen, aber die Überwachung selbst läuft unverändert
 * weiter. Schlüssel und Kennung liegen in den env-Dateien der Umgebung, nie im
 * Repo (req-033).
 */
export function readTelegramConfig(
  env: Record<string, string | undefined> = process.env,
): TelegramConfig | null {
  const botToken = (env.TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.TELEGRAM_CHAT_ID ?? "").trim();
  if (!botToken || !chatId) return null;
  return { botToken, chatId };
}

/** Eine eingegangene Nachricht, auf das reduziert, was hier zählt. */
export type TelegramUpdate = {
  updateId: number;
  /** Aus welchem Chat sie kam — der Türsteher dieses Features. */
  chatId: string;
  text: string;
};

export interface TelegramClient {
  /** Eine Nachricht in den hinterlegten Chat. Wirft, wenn Telegram nicht mag. */
  send(text: string): Promise<void>;
  /**
   * Neue Nachrichten ab `offset`. Wartet bis zu UPDATE_TIMEOUT_SECONDS auf
   * eine — ohne Nachricht kommt eine leere Liste zurück, kein Fehler.
   */
  updates(offset: number): Promise<TelegramUpdate[]>;
}

type RawUpdate = {
  update_id?: number;
  message?: {
    text?: string;
    chat?: { id?: number | string };
  };
};

/**
 * Was die Bot-API zurückgibt, in unsere Form. Alles ohne Text oder ohne
 * Chat-Kennung fällt raus: Bilder, Beitritte und dergleichen sind keine
 * Befehle, sollen aber auch nicht als leerer Befehl durchrutschen.
 */
export function parseUpdates(raw: unknown): TelegramUpdate[] {
  const list = (raw as { result?: RawUpdate[] })?.result;
  if (!Array.isArray(list)) return [];
  const out: TelegramUpdate[] = [];
  for (const item of list) {
    const updateId = Number(item?.update_id);
    const text = item?.message?.text;
    const chat = item?.message?.chat?.id;
    if (!Number.isFinite(updateId)) continue;
    if (typeof text !== "string" || text.trim() === "") continue;
    if (chat === undefined || chat === null || String(chat).trim() === "") continue;
    out.push({ updateId, chatId: String(chat), text: text.trim() });
  }
  return out;
}

/**
 * Kommt diese Nachricht aus dem hinterlegten Chat? Alles andere wird verworfen,
 * OHNE zu antworten (req-033) — eine Antwort wäre schon die Auskunft, dass hier
 * etwas zu holen ist.
 */
export function fromAllowedChat(
  update: TelegramUpdate,
  config: TelegramConfig,
): boolean {
  return update.chatId === config.chatId.trim();
}

/** Höchster `updateId` einer Liste, für den nächsten Abruf. */
export function nextOffset(updates: TelegramUpdate[], current: number): number {
  return updates.reduce((max, u) => Math.max(max, u.updateId + 1), current);
}

export function createTelegramClient(
  config: TelegramConfig,
  fetchImpl: typeof fetch = fetch,
): TelegramClient {
  const base = `https://api.telegram.org/bot${config.botToken}`;

  return {
    async send(text) {
      const res = await fetchImpl(`${base}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: config.chatId,
          text,
          disable_web_page_preview: true,
        }),
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Telegram antwortet mit ${res.status}`);
    },

    async updates(offset) {
      const url =
        `${base}/getUpdates?timeout=${UPDATE_TIMEOUT_SECONDS}` +
        `&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`;
      const res = await fetchImpl(url, {
        signal: AbortSignal.timeout(TELEGRAM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`Telegram antwortet mit ${res.status}`);
      return parseUpdates(await res.json());
    },
  };
}
