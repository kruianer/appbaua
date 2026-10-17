import { describe, it, expect } from "vitest";
import { touchActiveSession, MAX_ACTIVE_SESSIONS } from "./chat-session-lru";

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
