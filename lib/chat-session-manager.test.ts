import { describe, it, expect, beforeEach } from "vitest";
import {
  sendChatMessage,
  startChatTurn,
  isChatTurnRunning,
  activeSessionRepoIds,
  resetActiveSessionsForTests,
  NO_TOKEN_MESSAGE,
  RATE_LIMIT_CHAT_MESSAGE,
} from "./chat-session-manager";
import { createMemoryChatSessionStore } from "./chat-session-store";
import type { Repo } from "./repos";

/** A promise plus the functions that settle it, for controlling timing in tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// req-040 AC4: eine Nachricht bekommt Claudes Antwort im Gespräch. AC7
// (persistiert "über einen Neustart") ist dieselbe Mechanik, bloß von einem
// zweiten Store-Zugriff aus gesehen — appendMessage persistiert sofort, ein
// "Neustart" ist für den Store nur ein weiterer Aufruf ohne In-Memory-Reste.

const repo: Repo = {
  id: "r1",
  name: "CellarVoice",
  url: "github.com/k/cellarvoice",
  active: true,
  model: "sonnet",
  monitored: false,
};

const repoOf = (id: string): Repo => ({ ...repo, id, name: id, url: `github.com/k/${id}` });

beforeEach(() => {
  resetActiveSessionsForTests();
});

describe("sendChatMessage (req-040)", () => {
  it("AC4: Claudes Antwort steht danach im Gespräch", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Welche Bugs liegen in ready?", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "kurz", report: "In ready liegt bug-099." }),
      now: () => new Date("2026-10-17T10:00:00.000Z"),
      getActiveRepoId: async () => null,
    });

    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Welche Bugs liegen in ready?"],
      ["assistant", "In ready liegt bug-099."],
    ]);
  });

  it("AC7: das Gespräch ist über einen frischen Store-Zugriff hinweg noch da (persistiert, kein In-Memory-Rest)", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "kurz", report: "Hi!" }),
      now: () => new Date("2026-10-17T10:00:00.000Z"),
      getActiveRepoId: async () => null,
    });

    // Ein "Neustart" simuliert: derselbe Store (steht für die Postgres-Zeile,
    // nicht für In-Memory-State des Prozesses) wird neu abgefragt.
    const messagesAfterRestart = await store.listMessages(repo.id);
    expect(messagesAfterRestart).toHaveLength(2);
    expect(messagesAfterRestart[1].content).toBe("Hi!");
  });

  it("AC15: bereitet das Repo über die Chat-eigene Arbeitskopie vor, nicht die des Workers", async () => {
    const store = createMemoryChatSessionStore();
    const prepared: string[] = [];
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async (r) => {
        prepared.push(r.id);
        return { dir: "/tmp/appbaua-chat/github-com-k-cellarvoice", branch: "dev" };
      },
      runClaude: async (dir) => ({ ok: true, summary: "ok", report: `lief in ${dir}` }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });
    expect(prepared).toEqual(["r1"]);
    const [, assistant] = await store.listMessages(repo.id);
    expect(assistant.content).toBe("lief in /tmp/appbaua-chat/github-com-k-cellarvoice");
  });

  it("ohne GitHub-Token wird nicht geklont, sondern eine Systemmeldung abgelegt", async () => {
    const store = createMemoryChatSessionStore();
    let prepareCalled = false;
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "", // explizit kein Token — anders als `undefined` fällt das nicht auf process.env zurück
      prepareRepo: async () => {
        prepareCalled = true;
        return { dir: "/x", branch: "dev" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });
    expect(prepareCalled).toBe(false);
    const messages = await store.listMessages(repo.id);
    expect(messages[1]).toMatchObject({ role: "system", content: NO_TOKEN_MESSAGE });
  });

  it("merkt sich die Claude-Sitzung, damit der nächste Turn sie fortsetzt (--resume)", async () => {
    const store = createMemoryChatSessionStore();
    const resumeSeen: (string | undefined)[] = [];
    const sessionIdSeen: (string | undefined)[] = [];
    const deps = {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      newSessionId: () => "sess-1",
      runClaude: async (
        _dir: string,
        _prompt: string,
        opts: { resume?: string; sessionId?: string },
      ) => {
        resumeSeen.push(opts.resume);
        sessionIdSeen.push(opts.sessionId);
        return { ok: true, summary: "ok", report: "ok" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    };
    await sendChatMessage(repo, "erste Nachricht", deps);
    await sendChatMessage(repo, "zweite Nachricht", deps);

    expect(sessionIdSeen[0]).toBe("sess-1");
    expect(resumeSeen[0]).toBeUndefined();
    expect(resumeSeen[1]).toBe("sess-1");
    expect(sessionIdSeen[1]).toBeUndefined();
  });
});

describe("Hinweispunkt (req-040 AC8/AC9)", () => {
  it("eine fertige Antwort markiert ihr Repo als ungelesen, wenn ein ANDERES Repo gerade offen ist", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort" }),
      now: () => new Date(),
      getActiveRepoId: async () => "ein-anderes-repo",
    });
    expect((await store.getSession(repo.id))?.unread).toBe(true);
    expect(await store.listUnreadRepoIds()).toEqual([repo.id]);
  });

  it("bleibt gelesen, wenn genau dieses Repo gerade offen ist", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort" }),
      now: () => new Date(),
      getActiveRepoId: async () => repo.id,
    });
    expect((await store.getSession(repo.id))?.unread).toBe(false);
    expect(await store.listUnreadRepoIds()).toEqual([]);
  });

  it("auch eine fehlgeschlagene Antwort markiert als ungelesen, wenn das Repo nicht offen ist", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: false, summary: "kaputt", report: "" }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });
    expect((await store.getSession(repo.id))?.unread).toBe(true);
  });
});

describe("Abo-Limit (req-040 AC13)", () => {
  it("erreicht das Abo-Limit, steht im Gespräch, dass das Limit erreicht ist und der Worker ebenfalls betroffen ist", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({
        ok: false,
        summary: "Rate-Limit: usage limit reached, try again at 1753560000",
        report: "",
      }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [, limitMessage] = await store.listMessages(repo.id);
    expect(limitMessage).toMatchObject({ role: "system", content: RATE_LIMIT_CHAT_MESSAGE });
    expect(limitMessage.content).toContain("Worker");
  });

  it("ein gewöhnlicher Fehler bekommt weiterhin seine eigene Fehlermeldung, keine Rate-Limit-Meldung", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: false, summary: "irgendein anderer Fehler", report: "" }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [, errorMessage] = await store.listMessages(repo.id);
    expect(errorMessage).toMatchObject({ role: "system", content: "Fehler: irgendein anderer Fehler" });
  });
});

describe("Fünf-Sitzungen-Grenze (req-040 AC10/AC11)", () => {
  const baseDeps = {
    store: createMemoryChatSessionStore(),
    token: "tok",
    prepareRepo: async (r: Repo) => ({ dir: `/chat/${r.id}`, branch: "dev" }),
    runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort" }),
    now: () => new Date(),
    getActiveRepoId: async () => null,
  };

  it("AC10: eine sechste Sitzung verdrängt die am längsten unbenutzte", async () => {
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) {
      await sendChatMessage(repoOf(id), "Hallo", { ...baseDeps, store: createMemoryChatSessionStore() });
    }
    expect(activeSessionRepoIds()).toEqual(["r1", "r2", "r3", "r4", "r5"]);

    await sendChatMessage(repoOf("r6"), "Hallo", { ...baseDeps, store: createMemoryChatSessionStore() });
    const active = activeSessionRepoIds();
    expect(active).toHaveLength(5);
    expect(active).not.toContain("r1"); // am längsten unbenutzt
    expect(active).toContain("r6");
  });

  it("AC11: das Gespräch des verdrängten Repos bleibt vollständig lesbar", async () => {
    const store = createMemoryChatSessionStore();
    for (const id of ["r1", "r2", "r3", "r4", "r5"]) {
      await sendChatMessage(repoOf(id), `Hallo von ${id}`, { ...baseDeps, store });
    }
    await sendChatMessage(repoOf("r6"), "Hallo von r6", { ...baseDeps, store });

    expect(activeSessionRepoIds()).not.toContain("r1");
    const r1Messages = await store.listMessages("r1");
    expect(r1Messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hallo von r1"],
      ["assistant", "Antwort"],
    ]);
  });
});

describe("Acht-Stunden-Leerlaufende (req-040 AC12)", () => {
  it("eine acht Stunden unbenutzte Sitzung endet von selbst, ohne dass dafür fünf andere nötig wären", async () => {
    const store = createMemoryChatSessionStore();
    let clockMs = 0;
    const deps = {
      store,
      token: "tok",
      prepareRepo: async (r: Repo) => ({ dir: `/chat/${r.id}`, branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort" }),
      now: () => new Date(clockMs),
      getActiveRepoId: async () => null,
    };

    await sendChatMessage(repo, "Hallo", deps);
    expect(activeSessionRepoIds()).toEqual([repo.id]);

    clockMs += 8 * 60 * 60_000 + 1; // acht Stunden und einen Moment später
    await sendChatMessage(repoOf("r2"), "Hallo von r2", deps);

    expect(activeSessionRepoIds()).not.toContain(repo.id);
    expect(activeSessionRepoIds()).toContain("r2");
  });

  it("das Gespräch bleibt da, und ich kann nach acht Stunden weiterschreiben", async () => {
    const store = createMemoryChatSessionStore();
    let clockMs = 0;
    const deps = {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort" }),
      now: () => new Date(clockMs),
      getActiveRepoId: async () => null,
    };

    await sendChatMessage(repo, "Erste Nachricht", deps);
    clockMs += 8 * 60 * 60_000 + 1;
    await sendChatMessage(repo, "Nach acht Stunden", deps);

    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => m.content)).toEqual([
      "Erste Nachricht",
      "Antwort",
      "Nach acht Stunden",
      "Antwort",
    ]);
  });
});

const wellarita: Repo = {
  id: "r2",
  name: "Wellarita",
  url: "github.com/k/wellarita",
  active: true,
  model: "sonnet",
  monitored: false,
};

describe("startChatTurn (req-040 AC5/AC6)", () => {
  it("isChatTurnRunning ist wahr, solange der Lauf noch nicht fertig ist, danach falsch", async () => {
    const store = createMemoryChatSessionStore();
    const gate = deferred<void>();
    const turn = startChatTurn(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => {
        await gate.promise;
        return { ok: true, summary: "ok", report: "fertig" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(isChatTurnRunning(repo.id)).toBe(true);
    gate.resolve();
    await turn;
    expect(isChatTurnRunning(repo.id)).toBe(false);
  });

  it("zwei Repos laufen unabhängig — das zweite bekommt seine Antwort, während das erste noch läuft", async () => {
    const storeA = createMemoryChatSessionStore();
    const storeB = createMemoryChatSessionStore();
    const gateA = deferred<void>();

    const turnA = startChatTurn(repo, "Frage an CellarVoice", {
      store: storeA,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => {
        await gateA.promise;
        return { ok: true, summary: "ok", report: "Antwort A" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const turnB = startChatTurn(wellarita, "Frage an Wellarita", {
      store: storeB,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r2", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "Antwort B" }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    // B ist fertig, OHNE dass A jemals freigegeben wurde — die beiden Läufe
    // blockieren sich nicht gegenseitig.
    await turnB;
    expect(isChatTurnRunning(wellarita.id)).toBe(false);
    expect(isChatTurnRunning(repo.id)).toBe(true);
    const bMessages = await storeB.listMessages(wellarita.id);
    expect(bMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(bMessages[1].content).toBe("Antwort B");

    // A bekommt sein Ergebnis unverändert, sobald es freigegeben wird.
    gateA.resolve();
    await turnA;
    const aMessages = await storeA.listMessages(repo.id);
    expect(aMessages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(aMessages[1].content).toBe("Antwort A");
  });
});
