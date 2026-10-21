import { describe, it, expect, beforeEach } from "vitest";
import {
  sendChatMessage,
  startChatTurn,
  isChatTurnRunning,
  activeSessionRepoIds,
  resetActiveSessionsForTests,
  cancelChatTurn,
  getChatSteps,
  resetChatStepsForTests,
  ABORTED_CHAT_MESSAGE,
  NO_TOKEN_MESSAGE,
  RATE_LIMIT_CHAT_MESSAGE,
  SESSION_LOST_MESSAGE,
} from "./chat-session-manager";
import { ABORTED_MESSAGE } from "./claude-runner";
import { createMemoryChatSessionStore } from "./chat-session-store";
import { authExpiredChatMessage } from "./auth-expired";
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
  resetChatStepsForTests();
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

describe("abgelaufene Anmeldung (bug-031)", () => {
  it("zeigt statt des rohen OAuth-Texts den Befehl für den Worker-Container der laufenden Umgebung", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      env: { APP_ORIGIN: "https://dev.appbaua.com" },
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({
        ok: false,
        summary: "Claude-Lauf fehlgeschlagen: Failed to authenticate: OAuth session expired and could not be refreshed",
        report: "",
      }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [, authMessage] = await store.listMessages(repo.id);
    expect(authMessage).toMatchObject({
      role: "system",
      content: authExpiredChatMessage({ APP_ORIGIN: "https://dev.appbaua.com" }),
    });
    expect(authMessage.content).toContain("appbaua-dev-worker-1");
  });

  it("nennt auf der prod-Umgebung den prod-Worker-Container, nicht den von dev", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      env: { APP_ORIGIN: "https://app.appbaua.com" },
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({
        ok: false,
        summary: "Failed to authenticate",
        report: "",
      }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [, authMessage] = await store.listMessages(repo.id);
    expect(authMessage.content).toContain("appbaua-prod-worker-1");
  });
});

describe("verlorene Sitzung (bug-029)", () => {
  it("verwirft die unbekannte Sitzung, beginnt neu und beantwortet die Nachricht trotzdem", async () => {
    const store = createMemoryChatSessionStore();
    await store.putSession({
      repoId: repo.id,
      claudeSessionId: "tote-sitzung",
      lastActiveAt: new Date(0).toISOString(),
      unread: false,
    });

    const resumeSeen: (string | undefined)[] = [];
    const sessionIdSeen: (string | undefined)[] = [];
    await sendChatMessage(repo, "Hallo nach dem Neustart", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      newSessionId: () => "frische-sitzung",
      runClaude: async (_dir, _prompt, opts: { resume?: string; sessionId?: string }) => {
        resumeSeen.push(opts.resume);
        sessionIdSeen.push(opts.sessionId);
        if (opts.resume) {
          return {
            ok: false,
            summary: "Claude-Lauf fehlgeschlagen: No conversation found with session ID: tote-sitzung",
            report: "",
          };
        }
        return { ok: true, summary: "ok", report: "Neue Antwort" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(resumeSeen).toEqual(["tote-sitzung", undefined]);
    expect(sessionIdSeen).toEqual([undefined, "frische-sitzung"]);

    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hallo nach dem Neustart"],
      ["system", SESSION_LOST_MESSAGE],
      ["assistant", "Neue Antwort"],
    ]);
    expect((await store.getSession(repo.id))?.claudeSessionId).toBe("frische-sitzung");
  });

  it("ein anderer Fehler löst KEINEN Neustart der Sitzung aus", async () => {
    const store = createMemoryChatSessionStore();
    await store.putSession({
      repoId: repo.id,
      claudeSessionId: "sitzung-1",
      lastActiveAt: new Date(0).toISOString(),
      unread: false,
    });

    let calls = 0;
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => {
        calls += 1;
        return { ok: false, summary: "irgendein anderer Fehler", report: "" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(calls).toBe(1);
    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Hallo"],
      ["system", "Fehler: irgendein anderer Fehler"],
    ]);
    expect((await store.getSession(repo.id))?.claudeSessionId).toBe("sitzung-1");
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

describe("Ein-Stunden-Leerlaufende (bug-038)", () => {
  it("eine Stunde lang unbenutzte Sitzung endet von selbst, ohne dass dafür fünf andere nötig wären", async () => {
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

    clockMs += 60 * 60_000 + 1; // eine Stunde und einen Moment später
    await sendChatMessage(repoOf("r2"), "Hallo von r2", deps);

    expect(activeSessionRepoIds()).not.toContain(repo.id);
    expect(activeSessionRepoIds()).toContain("r2");
  });

  it("das Gespräch bleibt da, und ich kann nach einer Stunde weiterschreiben", async () => {
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
    clockMs += 60 * 60_000 + 1;
    await sendChatMessage(repo, "Nach einer Stunde", deps);

    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => m.content)).toEqual([
      "Erste Nachricht",
      "Antwort",
      "Nach einer Stunde",
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

// bug-030: der Stopp-Knopf im Chat braucht einen Weg, GENAU DEN laufenden
// Claude-Aufruf eines Repos zu beenden — ohne das bisherige Gespräch anzurühren.
describe("cancelChatTurn (bug-030)", () => {
  it("meldet false, wenn für das Repo gerade nichts läuft", () => {
    expect(cancelChatTurn("kein-laufendes-repo")).toBe(false);
  });

  it("beendet den laufenden Lauf: die Antwort wird 'Abgebrochen.', das Gespräch bleibt sonst stehen", async () => {
    const store = createMemoryChatSessionStore();
    const signalSeen = deferred<AbortSignal>();
    const turn = startChatTurn(repo, "Frage, dann Stopp", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          signalSeen.resolve(opts.signal!);
          opts.signal!.addEventListener("abort", () =>
            resolve({ ok: false, summary: ABORTED_MESSAGE, report: "" }),
          );
        }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    await signalSeen.promise; // der Lauf steht und wartet auf den Abbruch
    expect(cancelChatTurn(repo.id)).toBe(true);
    await turn;

    const messages = await store.listMessages(repo.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Frage, dann Stopp"],
      ["system", ABORTED_CHAT_MESSAGE],
    ]);
    expect(isChatTurnRunning(repo.id)).toBe(false);
  });

  it("trifft nur das eigene Repo — ein anderes laufendes Repo bleibt unberührt", async () => {
    const storeA = createMemoryChatSessionStore();
    const storeB = createMemoryChatSessionStore();
    const signalSeenA = deferred<AbortSignal>();
    const gateB = deferred<void>();

    const turnA = startChatTurn(repo, "Frage an CellarVoice", {
      store: storeA,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { signal?: AbortSignal }) =>
        new Promise((resolve) => {
          signalSeenA.resolve(opts.signal!);
          opts.signal!.addEventListener("abort", () =>
            resolve({ ok: false, summary: ABORTED_MESSAGE, report: "" }),
          );
        }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const turnB = startChatTurn(wellarita, "Frage an Wellarita", {
      store: storeB,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r2", branch: "dev" }),
      runClaude: async () => {
        await gateB.promise;
        return { ok: true, summary: "ok", report: "Antwort B" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    await signalSeenA.promise;
    expect(cancelChatTurn(repo.id)).toBe(true);
    await turnA;

    // Wellarita lief die ganze Zeit unbeeinflusst weiter.
    expect(isChatTurnRunning(wellarita.id)).toBe(true);
    gateB.resolve();
    await turnB;
    const bMessages = await storeB.listMessages(wellarita.id);
    expect(bMessages[1]).toMatchObject({ role: "assistant", content: "Antwort B" });
  });

  it("ein zweiter Abbruch nach Ende des Laufs meldet false — es läuft dann nichts mehr", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "ok", report: "fertig" }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });
    expect(cancelChatTurn(repo.id)).toBe(false);
  });
});

// req-048: runClaude liefert über onOutput denselben Ereignisstrom, den der
// Worker seit req-008/bug-001 schon per describeEvent zeigt — hier wird er
// zusätzlich in getChatSteps() veröffentlicht, damit der Chat ihn lesen kann.
const toolUse = (id: string, name: string, input: Record<string, unknown>) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const toolResult = (id: string, content: string, isError: boolean) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });
const stepsOf = (json: string | null | undefined) => JSON.parse(json ?? "[]");

describe("sichtbare Schritte (req-048)", () => {
  it("meldet null, solange für das Repo kein Zug läuft oder lief", () => {
    expect(getChatSteps("kein-repo")).toBeNull();
  });

  it("onOutput-Aufrufe landen in getChatSteps und bleiben nach Ende des Zugs stehen", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Was steht in lib/foo.ts?", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { onEvent?: (line: string) => void }) => {
        opts.onEvent?.(toolUse("t1", "Read", { file_path: "lib/foo.ts" }));
        return { ok: true, summary: "ok", report: "Steht drin." };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(stepsOf(getChatSteps(repo.id))).toMatchObject([{ tool: "Read", target: "lib/foo.ts", status: "running" }]);
  });

  it("maskiert Zugangsschlüssel in den Schritten genauso wie der Worker (bug-003)", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Push das mal", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { onEvent?: (line: string) => void }) => {
        opts.onEvent?.(toolUse("t1", "Bash", { command: "curl -H 'Authorization: Bearer sk-ABCDEFGHIJKLMNOP'" }));
        return { ok: true, summary: "ok", report: "fertig" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(getChatSteps(repo.id)).not.toContain("sk-ABCDEFGHIJKLMNOP");
  });

  it("ein Abbruch (bug-030) lässt die bis dahin gezeigten Schritte stehen", async () => {
    const store = createMemoryChatSessionStore();
    const signalSeen = deferred<AbortSignal>();
    const turn = startChatTurn(repo, "Frage, dann Stopp", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (
        _dir,
        _prompt,
        opts: { signal?: AbortSignal; onEvent?: (line: string) => void },
      ) =>
        new Promise((resolve) => {
          opts.onEvent?.(toolUse("t1", "Bash", { command: "npm test" }));
          signalSeen.resolve(opts.signal!);
          opts.signal!.addEventListener("abort", () =>
            resolve({ ok: false, summary: ABORTED_MESSAGE, report: "" }),
          );
        }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    await signalSeen.promise;
    expect(cancelChatTurn(repo.id)).toBe(true);
    await turn;

    expect(stepsOf(getChatSteps(repo.id))).toMatchObject([{ tool: "Bash", target: "npm test" }]);
  });

  it("ein neuer Zug beginnt mit leeren Schritten statt die des vorigen Zugs fortzuführen", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Erster Zug", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { onEvent?: (line: string) => void }) => {
        opts.onEvent?.(toolUse("t1", "Read", { file_path: "alt.ts" }));
        return { ok: true, summary: "ok", report: "fertig" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });
    expect(stepsOf(getChatSteps(repo.id))).toMatchObject([{ tool: "Read", target: "alt.ts" }]);

    const sawStepsAtStart = deferred<string | null>();
    await sendChatMessage(repo, "Zweiter Zug", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => {
        sawStepsAtStart.resolve(getChatSteps(repo.id));
        return { ok: true, summary: "ok", report: "fertig" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(await sawStepsAtStart.promise).toBeNull();
  });
});

// req-049: die Schritte eines Zugs werden dauerhaft an SEINER Antwort
// gespeichert (nicht nur flüchtig in getChatSteps), damit eine ältere Frage
// beim Zurückrollen im Gespräch ihre eigenen Schritte noch zeigt — und der
// Zug läuft dafür ohne die 50-Zeilen-Kappung des Worker-Defaults.
describe("Schritte an der Antwort (req-049)", () => {
  it("die fertige Antwort trägt die Schritte des Zugs, der zu ihr führte", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Was steht in lib/foo.ts?", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { onEvent?: (line: string) => void }) => {
        opts.onEvent?.(toolUse("t1", "Read", { file_path: "lib/foo.ts" }));
        return { ok: true, summary: "ok", report: "Steht drin." };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [userMsg, answerMsg] = await store.listMessages(repo.id);
    expect(userMsg.steps).toBeUndefined();
    expect(stepsOf(answerMsg.steps)).toMatchObject([{ tool: "Read", target: "lib/foo.ts" }]);
  });

  it("ein Abbruch trägt ebenfalls die bis dahin gezeigten Schritte", async () => {
    const store = createMemoryChatSessionStore();
    const signalSeen = deferred<AbortSignal>();
    const turn = startChatTurn(repo, "Frage, dann Stopp", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (
        _dir,
        _prompt,
        opts: { signal?: AbortSignal; onEvent?: (line: string) => void },
      ) =>
        new Promise((resolve) => {
          opts.onEvent?.(toolUse("t1", "Bash", { command: "npm test" }));
          signalSeen.resolve(opts.signal!);
          opts.signal!.addEventListener("abort", () =>
            resolve({ ok: false, summary: ABORTED_MESSAGE, report: "" }),
          );
        }),
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    await signalSeen.promise;
    expect(cancelChatTurn(repo.id)).toBe(true);
    await turn;

    const [, abortMsg] = await store.listMessages(repo.id);
    expect(stepsOf(abortMsg.steps)).toMatchObject([{ tool: "Bash", target: "npm test" }]);
  });

  it("Status und Ergebnis kommen aus dem Ereignisstrom und bleiben an der Antwort (req-051)", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Laufen die Tests?", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async (_dir, _prompt, opts: { onEvent?: (line: string) => void }) => {
        opts.onEvent?.(toolUse("t1", "Bash", { command: "npm test" }));
        opts.onEvent?.(toolResult("t1", "FAIL 3 tests", true));
        opts.onEvent?.(toolUse("t2", "Read", { file_path: "a.ts" }));
        opts.onEvent?.(toolResult("t2", "inhalt", false));
        return { ok: true, summary: "ok", report: "Antwort" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    const [, answer] = await store.listMessages(repo.id);
    expect(stepsOf(answer.steps)).toMatchObject([
      { tool: "Bash", target: "npm test", status: "error", result: "FAIL 3 tests" },
      { tool: "Read", target: "a.ts", status: "ok", result: "inhalt" },
    ]);
  });
});

describe("Hintergrundlauf (bug-038)", () => {
  it("ein lang laufender Zug zählt als Arbeit: die Leerlaufstunde beginnt erst an seinem Ende", async () => {
    const store = createMemoryChatSessionStore();
    let clockMs = 0;
    const deps = {
      store,
      token: "tok",
      prepareRepo: async (r: Repo) => ({ dir: `/chat/${r.id}`, branch: "dev" }),
      runClaude: async () => {
        clockMs += 90 * 60_000; // der Zug dauert anderthalb Stunden
        return { ok: true, summary: "ok", report: "Antwort" };
      },
      now: () => new Date(clockMs),
      getActiveRepoId: async () => null,
    };
    await sendChatMessage(repo, "Lange Aufgabe", deps);
    clockMs += 30 * 60_000; // 30 Minuten nach Ende der Arbeit
    await sendChatMessage(repoOf("r2"), "Hallo", deps);
    expect(activeSessionRepoIds()).toContain(repo.id);
  });

  it("isChatTurnRunning zeigt den Zug, solange er läuft, und danach nicht mehr", async () => {
    const store = createMemoryChatSessionStore();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const turn = startChatTurn(repo, "Hallo", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => {
        await gate;
        return { ok: true, summary: "ok", report: "Antwort" };
      },
      getActiveRepoId: async () => null,
    });
    expect(isChatTurnRunning(repo.id)).toBe(true);
    release();
    await turn;
    await Promise.resolve();
    expect(isChatTurnRunning(repo.id)).toBe(false);
  });
});
