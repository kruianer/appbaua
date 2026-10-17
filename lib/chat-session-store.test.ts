import { describe, it, expect } from "vitest";
import { createMemoryChatSessionStore } from "./chat-session-store";

// req-040: Persistenz der Gespräche und der Claude-Sitzung je Repo.

describe("ChatSessionStore", () => {
  it("listMessages liefert die Nachrichten eines Repos in Schreibreihenfolge", async () => {
    const store = createMemoryChatSessionStore();
    await store.appendMessage({ repoId: "r1", role: "user", content: "a", createdAt: "t1" });
    await store.appendMessage({ repoId: "r2", role: "user", content: "x", createdAt: "t1" });
    await store.appendMessage({ repoId: "r1", role: "assistant", content: "b", createdAt: "t2" });

    expect(await store.listMessages("r1")).toEqual([
      { id: 1, repoId: "r1", role: "user", content: "a", createdAt: "t1" },
      { id: 3, repoId: "r1", role: "assistant", content: "b", createdAt: "t2" },
    ]);
    expect(await store.listMessages("r2")).toHaveLength(1);
  });

  it("ohne Sitzung gibt getSession null zurück", async () => {
    const store = createMemoryChatSessionStore();
    expect(await store.getSession("r1")).toBeNull();
  });

  it("putSession überschreibt die bestehende Sitzung desselben Repos", async () => {
    const store = createMemoryChatSessionStore();
    await store.putSession({ repoId: "r1", claudeSessionId: "s1", lastActiveAt: "t1" });
    await store.putSession({ repoId: "r1", claudeSessionId: "s1", lastActiveAt: "t2" });
    expect(await store.getSession("r1")).toEqual({
      repoId: "r1",
      claudeSessionId: "s1",
      lastActiveAt: "t2",
    });
  });
});
