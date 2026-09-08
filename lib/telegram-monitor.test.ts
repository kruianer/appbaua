import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import { createMemoryHealthStore, setHealthStore } from "./health-store";
import { createMemoryRunLogStore, setRunLogStore } from "./run-log-store";
import type { AppHealth } from "./health";
import type { TelegramClient, TelegramUpdate } from "./telegram";
import type { CommandDeps } from "./telegram-commands";
import {
  CHECK_TICK_MS,
  POLL_BACKOFF_MS,
  pollUpdatesOnce,
  runCheckLoop,
  runUpdateLoop,
  startTelegramMonitor,
} from "./telegram-monitor";

// Die beiden mitlaufenden Schleifen aus req-033. Was hier zählt: sie hören
// nicht auf, wenn Telegram wegbricht, und sie starten nicht ungefragt.

const CONFIG = { botToken: "123:ABC", chatId: "4711" };

const APP: AppHealth = {
  repoId: "r1",
  repoName: "LivingGardenTwin",
  repoUrl: "github.com/kruianer/livinggardentwin",
  lamp: "red",
  checks: [
    {
      kind: "container",
      status: "fail",
      detail: "lgt-prod-app (exited)",
      checkedAt: "2026-08-29T12:00:00.000Z",
      containers: [
        { id: "c1", name: "lgt-prod-app", state: "exited", status: "", failing: true },
      ],
    },
  ],
  checkedAt: "2026-08-29T12:00:00.000Z",
};

function message(updateId: number, text: string, chatId = CONFIG.chatId): TelegramUpdate {
  return { updateId, chatId, text };
}

/** Ein Bot, der eine vorbereitete Runde Nachrichten liefert. */
function clientStub(batches: TelegramUpdate[][]) {
  const sent: string[] = [];
  const offsets: number[] = [];
  let call = 0;
  const client: TelegramClient = {
    async send(text) {
      sent.push(text);
    },
    async updates(offset) {
      offsets.push(offset);
      return batches[call++] ?? [];
    },
  };
  return { client, sent, offsets };
}

function commandDeps() {
  const restarted: string[] = [];
  const commands: CommandDeps = {
    readApps: async () => [APP],
    restart: async (repoId, name) => {
      restarted.push(`${repoId}/${name}`);
      return { ok: true as const, container: name };
    },
  };
  return { commands, restarted };
}

beforeEach(() => {
  setHealthStore(createMemoryHealthStore());
  setRunLogStore(createMemoryRunLogStore());
  setStore(createMemoryStore([]));
});

describe("pollUpdatesOnce", () => {
  it("beantwortet jede Nachricht und rückt den Offset vor", async () => {
    const { client, sent } = clientStub([[message(4, "/status"), message(5, "/status")]]);
    const { commands } = commandDeps();

    const res = await pollUpdatesOnce(0, null, { client, config: CONFIG, commands });

    expect(sent).toHaveLength(2);
    expect(res.offset).toBe(6);
    expect(res.pending).toBeNull();
  });

  it("trägt eine offene Rückfrage über die Abrufe hinweg", async () => {
    const { client, sent } = clientStub([
      [message(1, "/neustart lgt-prod-app")],
      [message(2, "ja")],
    ]);
    const { commands, restarted } = commandDeps();
    const deps = { client, config: CONFIG, commands };

    const asked = await pollUpdatesOnce(0, null, deps);
    expect(restarted).toEqual([]);
    expect(asked.pending?.container).toBe("lgt-prod-app");

    const done = await pollUpdatesOnce(asked.offset, asked.pending, deps);
    expect(restarted).toEqual(["r1/lgt-prod-app"]);
    expect(done.pending).toBeNull();
    expect(sent[1]).toContain("wird neu gestartet");
  });

  it("eine fremde Nachricht wird still verworfen, rückt den Offset aber vor", async () => {
    const { client, sent } = clientStub([[message(8, "/status", "9999")]]);
    const { commands } = commandDeps();

    const res = await pollUpdatesOnce(0, null, { client, config: CONFIG, commands });

    expect(sent).toEqual([]);
    expect(res.offset).toBe(9);
  });
});

describe("runUpdateLoop", () => {
  it("macht nach einem Ausfall von Telegram weiter, statt aufzugeben", async () => {
    const slept: number[] = [];
    let rounds = 0;
    const client: TelegramClient = {
      async send() {},
      async updates() {
        rounds += 1;
        if (rounds === 1) throw new Error("ENOTFOUND");
        return [];
      },
    };

    await runUpdateLoop({
      client,
      config: CONFIG,
      commands: commandDeps().commands,
      sleep: async (ms) => {
        slept.push(ms);
      },
      keepGoing: () => rounds < 3,
    });

    expect(rounds).toBe(3);
    expect(slept).toEqual([POLL_BACKOFF_MS]);
  });
});

describe("runCheckLoop", () => {
  it("stößt Runden an und wartet dazwischen", async () => {
    const slept: number[] = [];
    let ticks = 0;

    await runCheckLoop({
      tick: async () => {
        ticks += 1;
      },
      sleep: async (ms) => {
        slept.push(ms);
      },
      keepGoing: () => ticks < 2,
    });

    expect(ticks).toBe(2);
    expect(slept).toEqual([CHECK_TICK_MS, CHECK_TICK_MS]);
  });

  it("eine gescheiterte Runde beendet den Takt nicht", async () => {
    let ticks = 0;
    await runCheckLoop({
      tick: async () => {
        ticks += 1;
        throw new Error("Docker weg");
      },
      sleep: async () => {},
      keepGoing: () => ticks < 2,
    });
    expect(ticks).toBe(2);
  });
});

describe("startTelegramMonitor", () => {
  it("startet nichts, solange keine Zugangsdaten hinterlegt sind", () => {
    const saved = {
      token: process.env.TELEGRAM_BOT_TOKEN,
      chat: process.env.TELEGRAM_CHAT_ID,
    };
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    try {
      expect(startTelegramMonitor()).toBe(false);
    } finally {
      if (saved.token !== undefined) process.env.TELEGRAM_BOT_TOKEN = saved.token;
      if (saved.chat !== undefined) process.env.TELEGRAM_CHAT_ID = saved.chat;
    }
  });
});
