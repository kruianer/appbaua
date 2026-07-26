import { describe, it, expect } from "vitest";
import {
  isRateLimit,
  resetAtFrom,
  pauseUntilFrom,
  DEFAULT_RATE_LIMIT_PAUSE_MS,
} from "./rate-limit";

const NOW = Date.UTC(2026, 6, 26, 20, 0, 0); // 2026-07-26 20:00:00Z

describe("isRateLimit (req-029)", () => {
  it("recognises the common phrasings", () => {
    expect(isRateLimit("Error: rate limit exceeded")).toBe(true);
    expect(isRateLimit("You have hit your usage limit")).toBe(true);
    expect(isRateLimit("429 Too Many Requests")).toBe(true);
    expect(isRateLimit("quota exceeded, retry later")).toBe(true);
    expect(isRateLimit("Overloaded")).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    expect(isRateLimit("FAIL lib/foo.test.ts > kaputt")).toBe(false);
    expect(isRateLimit("Repo vorbereiten fehlgeschlagen: no such host")).toBe(false);
    expect(isRateLimit("")).toBe(false);
    expect(isRateLimit(null)).toBe(false);
  });
});

describe("resetAtFrom (req-029)", () => {
  it("reads an ISO reset instant", () => {
    const at = resetAtFrom("usage limit, resets at 2026-07-26T21:00:00Z", NOW);
    expect(at).toBe(Date.UTC(2026, 6, 26, 21, 0, 0));
  });

  it("reads a unix-seconds reset timestamp", () => {
    const future = Math.floor(NOW / 1000) + 1800; // +30 min
    const at = resetAtFrom(`rate limit; try again at ${future}`, NOW);
    expect(at).toBe(future * 1000);
  });

  it("ignores a reset time in the past", () => {
    const past = Math.floor(NOW / 1000) - 100;
    expect(resetAtFrom(`resets ${past}`, NOW)).toBeNull();
  });

  it("returns null when no time is named", () => {
    expect(resetAtFrom("rate limit exceeded", NOW)).toBeNull();
  });
});

describe("pauseUntilFrom (req-029)", () => {
  it("uses the named reset instant when there is one", () => {
    const until = pauseUntilFrom("resets at 2026-07-26T21:00:00Z", NOW);
    expect(until).toBe(Date.UTC(2026, 6, 26, 21, 0, 0));
  });

  it("falls back to now + one hour when none is named", () => {
    expect(pauseUntilFrom("rate limit exceeded", NOW)).toBe(
      NOW + DEFAULT_RATE_LIMIT_PAUSE_MS,
    );
  });
});
