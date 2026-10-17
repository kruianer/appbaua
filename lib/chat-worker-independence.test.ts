import { describe, it, expect, beforeEach } from "vitest";
import { executeStep, type ExecuteDeps } from "./execute-step";
import { startChatTurn, isChatTurnRunning, resetActiveSessionsForTests } from "./chat-session-manager";
import { createMemoryChatSessionStore } from "./chat-session-store";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";

// req-040 AC14: eine laufende Chat-Sitzung darf NICHT beendet oder angehalten
// werden, wenn der nächtliche Worker einen Lauf beginnt — und umgekehrt darf
// eine laufende Chat-Sitzung einen Worker-Lauf nicht aufhalten. Die beiden
// Pfade teilen sich keinen Zustand (eigene Arbeitskopien seit AC15, eigene
// Status-Register), dieser Test führt beide tatsächlich gleichzeitig aus statt
// das nur zu behaupten.

const repo: Repo = {
  id: "r1",
  name: "CellarVoice",
  url: "github.com/k/cellarvoice",
  active: true,
  model: "sonnet",
  monitored: false,
};
const bug = defaultTaskTypes().find((t) => t.id === "bug")!;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function workerDeps(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
  return {
    token: "worker-tok",
    now: () => new Date(2026, 9, 17, 10, 0, 0),
    prepareRepo: async () => ({ dir: "/work/cellarvoice", branch: "dev" }),
    listReady: async (_dir: string, rel: string) =>
      rel.endsWith("/ready") ? ["bug-001-irgendwas.md"] : [],
    runClaude: async () => ({ ok: true, summary: "worker erledigt", report: "" }),
    commitAndPush: async () => ({ pushed: true, detail: "auf dev gepusht" }),
    moveMd: async () => {},
    discardChanges: async () => {},
    headCommit: async () => "abc123",
    writeRepoFile: async () => {},
    readRepoFile: async () => null,
    repoPathExists: async () => false,
    captureScreenshots: async () => ({ shot: [], missing: [] }),
    runTestGate: async () => ({ status: "green", command: "npm test", reason: "" }),
    setCurrentMd: async () => {},
    setCurrentOutput: async () => {},
    setCurrentModel: async () => {},
    getNetworkAbortCounts: async () => ({}),
    setNetworkAbortCounts: async () => {},
    ...over,
  };
}

beforeEach(() => {
  resetActiveSessionsForTests();
});

describe("Chat und nächtlicher Worker sind unabhängig (req-040 AC14)", () => {
  it("ein Worker-Lauf beginnt UND endet, während eine Chat-Sitzung noch läuft — die Chat-Sitzung bleibt davon unberührt", async () => {
    const chatStore = createMemoryChatSessionStore();
    const chatGate = deferred<void>();

    const chatTurn = startChatTurn(repo, "Welche Bugs liegen in ready?", {
      store: chatStore,
      token: "chat-tok",
      prepareRepo: async () => ({ dir: "/tmp/appbaua-chat/github-com-k-cellarvoice", branch: "dev" }),
      runClaude: async () => {
        await chatGate.promise;
        return { ok: true, summary: "ok", report: "In ready liegt bug-099." };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    expect(isChatTurnRunning(repo.id)).toBe(true);

    // Der Worker beginnt UND beendet einen kompletten Lauf für dasselbe Repo,
    // während die Chat-Sitzung noch auf ihre (zurückgehaltene) Antwort wartet.
    const workerResult = await executeStep(repo, bug, [], workerDeps());

    expect(workerResult.kind).toBe("success");
    // Die Chat-Sitzung läuft unverändert weiter — der Worker-Lauf hat sie
    // nicht beendet oder angehalten.
    expect(isChatTurnRunning(repo.id)).toBe(true);

    chatGate.resolve();
    await chatTurn;
    expect(isChatTurnRunning(repo.id)).toBe(false);
    const messages = await chatStore.listMessages(repo.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ["user", "Welche Bugs liegen in ready?"],
      ["assistant", "In ready liegt bug-099."],
    ]);
  });

  it("eine laufende Chat-Sitzung hält den Worker-Lauf nicht auf", async () => {
    const chatStore = createMemoryChatSessionStore();
    const chatGate = deferred<void>();

    const chatTurn = startChatTurn(repo, "Hallo", {
      store: chatStore,
      token: "chat-tok",
      prepareRepo: async () => ({ dir: "/tmp/appbaua-chat/github-com-k-cellarvoice", branch: "dev" }),
      runClaude: async () => {
        await chatGate.promise; // bleibt bis nach dem Test offen
        return { ok: true, summary: "ok", report: "Hi!" };
      },
      now: () => new Date(),
      getActiveRepoId: async () => null,
    });

    // Der Worker-Lauf schließt vollständig ab, OHNE dass die Chat-Sitzung
    // jemals freigegeben wurde.
    const workerResult = await executeStep(repo, bug, [], workerDeps());
    expect(workerResult.kind).toBe("success");
    expect(isChatTurnRunning(repo.id)).toBe(true); // immer noch unberührt

    chatGate.resolve();
    await chatTurn;
  });
});
