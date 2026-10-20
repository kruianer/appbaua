import { describe, it, expect } from "vitest";
import { isSessionNotFound } from "./chat-session-lost";

describe("isSessionNotFound (bug-029)", () => {
  it("recognises the CLI's own wording, wrapped in the run's failure summary", () => {
    expect(
      isSessionNotFound(
        "Claude-Lauf fehlgeschlagen: No conversation found with session ID: 1e5931c7-d5eb-40fd-94e4-4518dd3b757c",
      ),
    ).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isSessionNotFound("no conversation found with session id: abc")).toBe(true);
  });

  it("does not fire on an unrelated failure", () => {
    expect(isSessionNotFound("Claude-Lauf: Timeout (120 min)")).toBe(false);
    expect(isSessionNotFound("Claude-Code-CLI nicht verfügbar")).toBe(false);
  });

  it("does not fire on empty/missing text", () => {
    expect(isSessionNotFound("")).toBe(false);
    expect(isSessionNotFound(undefined)).toBe(false);
    expect(isSessionNotFound(null)).toBe(false);
  });
});
