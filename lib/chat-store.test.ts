import { describe, it, expect } from "vitest";
import { createMemoryChatUiStateStore } from "./chat-store";

// req-040 AC3: welches Repo zuletzt offen war, bleibt gespeichert.

describe("Chat-UI-Zustand (req-040)", () => {
  it("AC: ohne vorherige Auswahl gibt es kein aktives Repo", async () => {
    const store = createMemoryChatUiStateStore();
    expect(await store.getActiveRepoId()).toBeNull();
  });

  it("AC: das zuletzt gesetzte Repo bleibt das aktive", async () => {
    const store = createMemoryChatUiStateStore();
    await store.setActiveRepoId("r1");
    await store.setActiveRepoId("r2");
    expect(await store.getActiveRepoId()).toBe("r2");
  });
});
