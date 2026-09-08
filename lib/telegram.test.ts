import { describe, it, expect } from "vitest";
import {
  type TelegramUpdate,
  UPDATE_TIMEOUT_SECONDS,
  createTelegramClient,
  fromAllowedChat,
  nextOffset,
  parseUpdates,
  readTelegramConfig,
} from "./telegram";

// req-033, der Draht nach draußen. Der Türsteher (fromAllowedChat) steht hier
// mit drin: er ist der EINZIGE Schutz eines öffentlich ansprechbaren Bots.

const CONFIG = { botToken: "123:ABC", chatId: "4711" };

function update(over: Partial<TelegramUpdate> = {}): TelegramUpdate {
  return { updateId: 1, chatId: "4711", text: "/status", ...over };
}

describe("readTelegramConfig", () => {
  it("liest Schlüssel und Chat-Kennung aus der Umgebung", () => {
    expect(
      readTelegramConfig({ TELEGRAM_BOT_TOKEN: "123:ABC", TELEGRAM_CHAT_ID: "4711" }),
    ).toEqual(CONFIG);
  });

  it("ohne eines von beidem ist die Anbindung schlicht nicht eingerichtet", () => {
    expect(readTelegramConfig({ TELEGRAM_BOT_TOKEN: "123:ABC" })).toBeNull();
    expect(readTelegramConfig({ TELEGRAM_CHAT_ID: "4711" })).toBeNull();
    expect(readTelegramConfig({})).toBeNull();
    expect(
      readTelegramConfig({ TELEGRAM_BOT_TOKEN: "  ", TELEGRAM_CHAT_ID: "4711" }),
    ).toBeNull();
  });
});

describe("fromAllowedChat", () => {
  it("lässt den hinterlegten Chat durch", () => {
    expect(fromAllowedChat(update(), CONFIG)).toBe(true);
  });

  it("AC: eine Nachricht aus einem fremden Chat kommt nicht durch", () => {
    expect(fromAllowedChat(update({ chatId: "9999" }), CONFIG)).toBe(false);
  });
});

describe("parseUpdates", () => {
  it("liest Nummer, Chat und Text", () => {
    const parsed = parseUpdates({
      ok: true,
      result: [
        { update_id: 7, message: { text: " /status ", chat: { id: 4711 } } },
      ],
    });
    expect(parsed).toEqual([{ updateId: 7, chatId: "4711", text: "/status" }]);
  });

  it("überspringt alles ohne Text oder ohne Chat", () => {
    const parsed = parseUpdates({
      result: [
        { update_id: 1, message: { chat: { id: 4711 } } }, // ein Bild
        { update_id: 2, message: { text: "   ", chat: { id: 4711 } } },
        { update_id: 3, message: { text: "hallo" } },
        { message: { text: "hallo", chat: { id: 4711 } } },
        { update_id: 5, message: { text: "hallo", chat: { id: 4711 } } },
      ],
    });
    expect(parsed.map((u) => u.updateId)).toEqual([5]);
  });

  it("verträgt eine kaputte Antwort", () => {
    expect(parseUpdates(null)).toEqual([]);
    expect(parseUpdates({ ok: false })).toEqual([]);
    expect(parseUpdates({ result: "nope" })).toEqual([]);
  });
});

describe("nextOffset", () => {
  it("fragt beim nächsten Mal hinter der letzten Nachricht weiter", () => {
    expect(nextOffset([update({ updateId: 7 }), update({ updateId: 9 })], 0)).toBe(10);
  });

  it("ohne neue Nachricht bleibt der Stand", () => {
    expect(nextOffset([], 42)).toBe(42);
  });
});

describe("createTelegramClient", () => {
  it("schickt Text in den hinterlegten Chat", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createTelegramClient(CONFIG, (async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response("{}", { status: 200 });
    }) as typeof fetch);

    await client.send("hallo");

    expect(calls[0].url).toBe("https://api.telegram.org/bot123:ABC/sendMessage");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      chat_id: "4711",
      text: "hallo",
    });
  });

  it("meldet einen abgelehnten Versand als Fehler", async () => {
    const client = createTelegramClient(CONFIG, (async () =>
      new Response("nope", { status: 403 })) as typeof fetch);
    await expect(client.send("hallo")).rejects.toThrow("403");
  });

  it("holt Nachrichten ab Offset und wartet dabei auf eine", async () => {
    let seen = "";
    const client = createTelegramClient(CONFIG, (async (url) => {
      seen = String(url);
      return new Response(
        JSON.stringify({
          result: [{ update_id: 3, message: { text: "/status", chat: { id: 4711 } } }],
        }),
        { status: 200 },
      );
    }) as typeof fetch);

    const updates = await client.updates(3);

    expect(seen).toContain("/getUpdates");
    expect(seen).toContain("offset=3");
    expect(seen).toContain(`timeout=${UPDATE_TIMEOUT_SECONDS}`);
    expect(updates).toEqual([{ updateId: 3, chatId: "4711", text: "/status" }]);
  });
});
