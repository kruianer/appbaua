import { describe, it, expect } from "vitest";
import {
  touchActiveSession,
  pruneIdleSessions,
  MAX_ACTIVE_SESSIONS,
  SESSION_IDLE_MS,
} from "./chat-session-lru";

// req-040 AC10/AC11: höchstens fünf gleichzeitige Sitzungen; die am
// längsten unbenutzte wird für eine sechste verdrängt.

describe("touchActiveSession", () => {
  it("fügt ein neues Repo hinzu, solange die Grenze nicht erreicht ist", () => {
    const { active, evicted } = touchActiveSession(["a", "b"], "c");
    expect(active).toEqual(["a", "b", "c"]);
    expect(evicted).toBeNull();
  });

  it("verdrängt bei der sechsten Sitzung die am längsten unbenutzte (die erste)", () => {
    const five = ["a", "b", "c", "d", "e"];
    expect(five).toHaveLength(MAX_ACTIVE_SESSIONS);
    const { active, evicted } = touchActiveSession(five, "f");
    expect(evicted).toBe("a");
    expect(active).toEqual(["b", "c", "d", "e", "f"]);
    expect(active).toHaveLength(MAX_ACTIVE_SESSIONS);
  });

  it("erneutes Antippen eines bereits aktiven Repos verdrängt niemanden, macht es nur zum zuletzt benutzten", () => {
    const five = ["a", "b", "c", "d", "e"];
    const { active, evicted } = touchActiveSession(five, "a");
    expect(evicted).toBeNull();
    expect(active).toEqual(["b", "c", "d", "e", "a"]);
  });

  it("verdrängt niemals das gerade angetippte Repo selbst", () => {
    const five = ["a", "b", "c", "d", "e"];
    const { evicted } = touchActiveSession(five, "f");
    expect(evicted).not.toBe("f");
  });
});

// bug-038: eine Sitzung ohne Eingabe eine Stunde lang wird beendet.
describe("pruneIdleSessions", () => {
  it("lässt eine Sitzung innerhalb der eine Stunde unberührt", () => {
    const lastActiveAtMs = { a: 1000 };
    const result = pruneIdleSessions(["a"], lastActiveAtMs, 1000 + SESSION_IDLE_MS);
    expect(result).toEqual(["a"]);
  });

  it("entfernt eine Sitzung, die länger als eine Stunde nicht benutzt wurde", () => {
    const lastActiveAtMs = { a: 1000 };
    const result = pruneIdleSessions(["a"], lastActiveAtMs, 1000 + SESSION_IDLE_MS + 1);
    expect(result).toEqual([]);
  });

  it("lässt eine Sitzung mit noch laufendem Zug nie ablaufen", () => {
    const lastActiveAtMs = { a: 0 };
    const result = pruneIdleSessions(
      ["a"],
      lastActiveAtMs,
      SESSION_IDLE_MS * 10,
      SESSION_IDLE_MS,
      new Set(["a"]),
    );
    expect(result).toEqual(["a"]);
  });

  it("betrifft nur die abgelaufene Sitzung, andere bleiben aktiv", () => {
    const lastActiveAtMs = { a: 0, b: 1000 };
    const result = pruneIdleSessions(["a", "b"], lastActiveAtMs, 1000 + SESSION_IDLE_MS);
    expect(result).toEqual(["b"]);
  });
});
