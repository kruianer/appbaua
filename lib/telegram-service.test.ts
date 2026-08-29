import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import { createMemoryHealthStore, getHealthStore, setHealthStore } from "./health-store";
import {
  createMemoryRunLogStore,
  getRunLogStore,
  setRunLogStore,
} from "./run-log-store";
import type { DockerClient } from "./docker";
import type { AppHealth, DockerContainer } from "./health";
import type { Repo } from "./repos";
import { runDueChecks, updateHealthSettings } from "./health-service";
import type { TelegramClient, TelegramUpdate } from "./telegram";
import { alertKey } from "./telegram-alerts";
import type { CommandDeps } from "./telegram-commands";
import {
  TELEGRAM_LOG_LABEL,
  handleUpdate,
  notifyAfterRound,
} from "./telegram-service";

// req-033 an der Naht: eine echte Prüfrunde bis zur Nachricht im Chat, und was
// passiert, wenn Telegram gerade nicht erreichbar ist.

const CONFIG = { botToken: "123:ABC", chatId: "4711" };

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: "r1",
    name: "LivingGardenTwin",
    url: "github.com/kruianer/livinggardentwin",
    active: true,
    model: "sonnet",
    monitored: true,
    ...over,
  };
}

function container(name: string, over: Partial<DockerContainer> = {}): DockerContainer {
  return { id: name, name, state: "running", status: "Up 3 hours", project: "lgt-prod", ...over };
}

function dockerStub(containers: DockerContainer[]): DockerClient {
  return {
    async list() {
      return containers;
    },
    async env() {
      return null;
    },
    async exec() {
      return { exitCode: 0, output: "" };
    },
    async restart() {},
  };
}

/** Ein Bot, der mitschreibt statt zu senden. */
function clientStub(failing = false) {
  const sent: string[] = [];
  const client: TelegramClient = {
    async send(text) {
      if (failing) throw new Error("getaddrinfo ENOTFOUND api.telegram.org");
      sent.push(text);
    },
    async updates() {
      return [];
    },
  };
  return { client, sent };
}

const T = (minutes: number) => new Date(Date.UTC(2026, 7, 29, 12, minutes));

function healthOf(
  status: "ok" | "fail",
  at: Date,
  detail = "lgt-prod-monitoring-watchdog (Neustart-Schleife)",
): AppHealth[] {
  return [
    {
      repoId: "r1",
      repoName: "LivingGardenTwin",
      repoUrl: "github.com/kruianer/livinggardentwin",
      lamp: status === "ok" ? "green" : "red",
      checks: [{ kind: "container", status, detail, checkedAt: at.toISOString() }],
      checkedAt: at.toISOString(),
    },
  ];
}

beforeEach(() => {
  setHealthStore(createMemoryHealthStore());
  setRunLogStore(createMemoryRunLogStore());
  setStore(createMemoryStore([repo()]));
});

describe("notifyAfterRound", () => {
  it("schickt die Meldung erst beim zweiten Fehlschlag in Folge", async () => {
    const { client, sent } = clientStub();

    await notifyAfterRound(healthOf("fail", T(0)), { client });
    expect(sent).toEqual([]);

    await notifyAfterRound(healthOf("fail", T(5)), { client });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("LivingGardenTwin");
  });

  it("AC: mit abgeschalteten Telegram-Meldungen kommt KEINE Nachricht", async () => {
    await updateHealthSettings({ telegram: false });
    const { client, sent } = clientStub();

    await notifyAfterRound(healthOf("fail", T(0)), { client });
    await notifyAfterRound(healthOf("fail", T(5)), { client });

    expect(sent).toEqual([]);
    // Der Ausfall selbst ist trotzdem bekannt — nur eben still.
    const state = await getHealthStore().getAlertState();
    expect(state[alertKey("r1", "container")].fails).toBe(2);
  });

  it("ohne eingerichteten Bot passiert nichts, und nichts geht kaputt", async () => {
    await expect(
      notifyAfterRound(healthOf("fail", T(0)), { client: null }),
    ).resolves.toEqual([]);
  });

  it("AC: ein fehlgeschlagener Versand steht im Verlauf", async () => {
    const { client } = clientStub(true);

    await notifyAfterRound(healthOf("fail", T(0)), { client, now: () => T(0) });
    const sent = await notifyAfterRound(healthOf("fail", T(5)), {
      client,
      now: () => T(5),
    });

    expect(sent).toEqual([]);
    const [entry] = await getRunLogStore().list(0, 10);
    expect(entry.status).toBe("error");
    expect(entry.taskType).toBe(TELEGRAM_LOG_LABEL);
    expect(entry.repo).toBe("LivingGardenTwin");
    expect(entry.message).toContain("nicht zugestellt");
  });

  it("nach einem gescheiterten Versand wird es erneut versucht", async () => {
    const failing = clientStub(true);
    await notifyAfterRound(healthOf("fail", T(0)), { client: failing.client });
    await notifyAfterRound(healthOf("fail", T(5)), { client: failing.client });

    const working = clientStub();
    await notifyAfterRound(healthOf("fail", T(10)), { client: working.client });

    expect(working.sent).toHaveLength(1);
  });

  it("merkt sich Gemeldetes über einen Neustart hinweg", async () => {
    const { client, sent } = clientStub();
    await notifyAfterRound(healthOf("fail", T(0)), { client });
    await notifyAfterRound(healthOf("fail", T(5)), { client });

    // Ein frischer Prozess liest denselben Speicher.
    const stored = await getHealthStore().getAlertState();
    expect(stored[alertKey("r1", "container")]).toMatchObject({ alerted: true });

    await notifyAfterRound(healthOf("fail", T(10)), { client });
    expect(sent).toHaveLength(1);
  });
});

describe("runDueChecks meldet, was die Runde gefunden hat", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = CONFIG.botToken;
    process.env.TELEGRAM_CHAT_ID = CONFIG.chatId;
  });

  afterEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = saved.TELEGRAM_BOT_TOKEN;
    process.env.TELEGRAM_CHAT_ID = saved.TELEGRAM_CHAT_ID;
  });

  it("AC: nach der zweiten fehlgeschlagenen Prüfrunde kommt die Nachricht", async () => {
    const posts: string[] = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      posts.push(String(JSON.parse(String(init?.body)).text));
      expect(String(url)).toContain("/sendMessage");
      return new Response("{}", { status: 200 });
    }) as typeof fetch;
    const realFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const docker = dockerStub([
        container("lgt-prod-app"),
        container("lgt-prod-monitoring-watchdog", { state: "restarting" }),
      ]);
      const deps = { docker, readHealthMd: async () => null };

      expect(await runDueChecks({ ...deps, now: () => T(0) })).toBe(true);
      expect(posts).toEqual([]);

      expect(await runDueChecks({ ...deps, now: () => T(6) })).toBe(true);
      expect(posts).toHaveLength(1);
      expect(posts[0]).toContain("LivingGardenTwin");
      expect(posts[0]).toContain("lgt-prod-monitoring-watchdog");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("handleUpdate — wer schreiben darf", () => {
  function updateDeps() {
    const restarted: string[] = [];
    const { client, sent } = clientStub();
    const commands: CommandDeps = {
      readApps: async () => healthOf("fail", T(0)),
      restart: async (repoId, name) => {
        restarted.push(`${repoId}/${name}`);
        return { ok: true as const, container: name };
      },
    };
    return { deps: { ...commands, client, config: CONFIG }, sent, restarted };
  }

  function update(over: Partial<TelegramUpdate> = {}): TelegramUpdate {
    return { updateId: 1, chatId: CONFIG.chatId, text: "/status", ...over };
  }

  it("beantwortet den hinterlegten Chat", async () => {
    const { deps, sent } = updateDeps();
    await handleUpdate(update(), null, deps);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("LivingGardenTwin");
  });

  it("AC: eine fremde Nachricht bekommt KEINE Antwort und führt nichts aus", async () => {
    const { deps, sent, restarted } = updateDeps();

    await handleUpdate(update({ chatId: "9999", text: "/status" }), null, deps);
    const pending = await handleUpdate(
      update({ chatId: "9999", text: "/neustart lgt-prod-app" }),
      null,
      deps,
    );

    expect(sent).toEqual([]);
    expect(restarted).toEqual([]);
    expect(pending).toBeNull();
  });

  it("eine offene Rückfrage übersteht eine fremde Nachricht unverändert", async () => {
    const { deps, restarted } = updateDeps();
    const mine = {
      repoId: "r1",
      repoName: "LivingGardenTwin",
      container: "lgt-prod-app",
    };

    // Der Fremde schreibt "ja" — das darf die Rückfrage weder auslösen noch
    // wegnehmen.
    const after = await handleUpdate(update({ chatId: "9999", text: "ja" }), mine, deps);

    expect(restarted).toEqual([]);
    expect(after).toEqual(mine);
  });
});
