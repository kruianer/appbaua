import { describe, it, expect } from "vitest";
import {
  type RunLogEntry,
  RECURRING_MD,
  RECURRING_MD_LABEL,
  mdLabel,
} from "./run-log";

// req-015: what a Verlauf entry shows as its second line. Three cases, and the
// third one is the point — an entry that never recorded a name must stay silent
// instead of inheriting the placeholder of the recurring tasks.

describe("mdLabel (req-015)", () => {
  it("AC: a file-driven run shows the name of its .md", () => {
    expect(mdLabel({ md: "req-020-beispiel.md" })).toBe("req-020-beispiel.md");
  });

  it("AC: a recurring run shows the placeholder", () => {
    expect(mdLabel({ md: RECURRING_MD })).toBe(RECURRING_MD_LABEL);
    expect(RECURRING_MD_LABEL).toBe("wiederkehrende Aufgabe");
  });

  it("AC: an entry from before req-015 has no second line", () => {
    // Never stored (old file/JSON rows) and NULL (old Postgres rows) are the
    // same thing: nothing was recorded, so nothing is shown.
    expect(mdLabel({})).toBeNull();
    expect(mdLabel({ md: null })).toBeNull();
  });

  it("works on a whole log entry, not just the md field", () => {
    const entry: RunLogEntry = {
      id: 7,
      startedAt: new Date(2026, 6, 26, 10, 0).toISOString(),
      endedAt: new Date(2026, 6, 26, 10, 12).toISOString(),
      repo: "appbaua",
      taskType: "Requirements",
      status: "success",
      message: "erledigt",
      md: "req-020-beispiel.md",
    };
    expect(mdLabel(entry)).toBe("req-020-beispiel.md");
  });
});
