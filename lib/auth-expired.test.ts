import { describe, it, expect } from "vitest";
import {
  isAuthExpired,
  AUTH_EXPIRED_MESSAGE,
  AUTH_EXPIRED_PAUSE_MS,
  authExpiredWorkerContainer,
  authExpiredChatMessage,
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

describe("authExpiredWorkerContainer (bug-031)", () => {
  it("names the dev worker container on the dev origin", () => {
    expect(
      authExpiredWorkerContainer({ APP_ORIGIN: "https://dev.appbaua.com" }),
    ).toBe("appbaua-dev-worker-1");
  });

  it("names the prod worker container on the prod origin", () => {
    expect(
      authExpiredWorkerContainer({ APP_ORIGIN: "https://app.appbaua.com" }),
    ).toBe("appbaua-prod-worker-1");
  });

  it("falls back to dev without a set APP_ORIGIN (local development)", () => {
    expect(authExpiredWorkerContainer({})).toBe("appbaua-dev-worker-1");
  });
});

describe("authExpiredChatMessage (bug-031)", () => {
  it("names a single concrete command for the running environment, in a copy-able block", () => {
    const message = authExpiredChatMessage({ APP_ORIGIN: "https://dev.appbaua.com" });
    expect(message).toContain(
      "```\ndocker exec -it appbaua-dev-worker-1 claude login\n```",
    );
  });

  it("names the prod container on the prod origin — dev and prod must not be confused", () => {
    const devMessage = authExpiredChatMessage({ APP_ORIGIN: "https://dev.appbaua.com" });
    const prodMessage = authExpiredChatMessage({ APP_ORIGIN: "https://app.appbaua.com" });
    expect(devMessage).not.toBe(prodMessage);
    expect(prodMessage).toContain("appbaua-prod-worker-1");
  });
});
