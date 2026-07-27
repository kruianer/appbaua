import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAuthStore, setAuthStore } from "./auth-store";
import { createSession, userIdForSession, endSession } from "./auth-session";

const NOW = new Date(2026, 6, 27, 10, 0, 0);

beforeEach(() => {
  setAuthStore(createMemoryAuthStore());
});

describe("auth-session (req-023)", () => {
  it("a created session resolves back to its user id", async () => {
    const id = await createSession("u1", () => NOW);
    expect(await userIdForSession(id, () => NOW)).toBe("u1");
  });

  it("no cookie value -> null, no throw", async () => {
    expect(await userIdForSession(undefined)).toBeNull();
  });

  it("an unknown session id -> null", async () => {
    expect(await userIdForSession("does-not-exist")).toBeNull();
  });

  it("an expired session -> null even though the row still exists", async () => {
    const id = await createSession("u1", () => NOW);
    const wayLater = new Date(NOW.getTime() + 40 * 24 * 60 * 60_000); // +40 days
    expect(await userIdForSession(id, () => wayLater)).toBeNull();
  });

  it("endSession revokes it immediately", async () => {
    const id = await createSession("u1", () => NOW);
    await endSession(id);
    expect(await userIdForSession(id, () => NOW)).toBeNull();
  });

  it("two sessions for the same user get different ids", async () => {
    const a = await createSession("u1", () => NOW);
    const b = await createSession("u1", () => NOW);
    expect(a).not.toBe(b);
  });
});
