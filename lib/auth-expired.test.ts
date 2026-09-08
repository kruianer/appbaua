import { describe, it, expect } from "vitest";
import {
  isAuthExpired,
  AUTH_EXPIRED_MESSAGE,
  AUTH_EXPIRED_PAUSE_MS,
} from "./auth-expired";

describe("isAuthExpired (bug-019)", () => {
  it("recognises the exact prod wording (22.08., livinggardentwin)", () => {
    // The message seen after the refreshToken expired: "Claude-Lauf
    // fehlgeschlagen: Failed to authenticate: OAuth session expired and could
    // not be refreshed" — this is what today's isRateLimit missed entirely.
    expect(
      isAuthExpired(
        "Claude-Lauf fehlgeschlagen: Failed to authenticate: OAuth session expired and could not be refreshed",
      ),
    ).toBe(true);
  });

  it("recognises other common OAuth-expiry phrasings", () => {
    expect(isAuthExpired("invalid_grant: token expired")).toBe(true);
    expect(isAuthExpired("Error: not authenticated")).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    expect(isAuthExpired("FAIL lib/foo.test.ts > kaputt")).toBe(false);
    expect(isAuthExpired("rate limit exceeded")).toBe(false);
    expect(isAuthExpired("Repo vorbereiten fehlgeschlagen: no such host")).toBe(
      false,
    );
    expect(isAuthExpired("")).toBe(false);
    expect(isAuthExpired(null)).toBe(false);
    expect(isAuthExpired(undefined)).toBe(false);
  });
});

describe("AUTH_EXPIRED_MESSAGE (bug-019)", () => {
  it("names the concrete command instead of the technical OAuth text", () => {
    expect(AUTH_EXPIRED_MESSAGE).toContain("claude login");
    expect(AUTH_EXPIRED_MESSAGE).not.toContain("OAuth");
  });
});

describe("AUTH_EXPIRED_PAUSE_MS (bug-019)", () => {
  it("is a long pause, not a short retry — a login does not resolve on its own", () => {
    expect(AUTH_EXPIRED_PAUSE_MS).toBeGreaterThanOrEqual(60 * 60_000);
  });
});
