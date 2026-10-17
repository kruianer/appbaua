import { describe, it, expect } from "vitest";
import { sendChatMessage, NO_TOKEN_MESSAGE } from "./chat-session-manager";
import { createMemoryChatSessionStore } from "./chat-session-store";
import type { Repo } from "./repos";

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

describe("sendChatMessage (req-040)", () => {
  it("AC4: Claudes Antwort steht danach im Gespräch", async () => {
    const store = createMemoryChatSessionStore();
    await sendChatMessage(repo, "Welche Bugs liegen in ready?", {
      store,
      token: "tok",
      prepareRepo: async () => ({ dir: "/chat/r1", branch: "dev" }),
      runClaude: async () => ({ ok: true, summary: "kurz", report: "In ready liegt bug-099." }),
      now: () => new Date("2026-10-17T10:00:00.000Z"),
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
    };
    await sendChatMessage(repo, "erste Nachricht", deps);
    await sendChatMessage(repo, "zweite Nachricht", deps);

    expect(sessionIdSeen[0]).toBe("sess-1");
    expect(resumeSeen[0]).toBeUndefined();
    expect(resumeSeen[1]).toBe("sess-1");
    expect(sessionIdSeen[1]).toBeUndefined();
  });
});
