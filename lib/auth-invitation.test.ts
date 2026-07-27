import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryAuthStore, setAuthStore, getAuthStore } from "./auth-store";
import { createInvitation, redeemInvitation } from "./auth-invitation";

const NOW = new Date(2026, 6, 27, 10, 0, 0);

beforeEach(() => {
  setAuthStore(createMemoryAuthStore());
});

describe("createInvitation / redeemInvitation (req-023)", () => {
  it("AC: redeeming a valid invitation creates a non-operator user and starts registration", async () => {
    const inv = await createInvitation("operator1", () => NOW);
    const result = await redeemInvitation(inv.token, () => NOW);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.user.isOperator).toBe(false);
    expect(result.registration.token).toBeTruthy();
  });

  it("AC: an unknown token is rejected — no offene Selbstregistrierung", async () => {
    const result = await redeemInvitation("never-issued", () => NOW);
    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("a token cannot be redeemed twice", async () => {
    const inv = await createInvitation("operator1", () => NOW);
    await redeemInvitation(inv.token, () => NOW);
    const second = await redeemInvitation(inv.token, () => NOW);
    expect(second).toEqual({ ok: false, error: "already-used" });
  });

  it("an expired invitation is rejected, even though the token itself is real", async () => {
    const inv = await createInvitation("operator1", () => NOW);
    const wayLater = new Date(NOW.getTime() + 10 * 24 * 60 * 60_000); // +10 days, TTL is 7
    const result = await redeemInvitation(inv.token, () => wayLater);
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("redeeming does not create a second user when it fails", async () => {
    await redeemInvitation("bogus", () => NOW);
    expect(await getAuthStore().countUsers()).toBe(0);
  });
});
