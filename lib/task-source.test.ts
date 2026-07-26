import { describe, it, expect } from "vitest";
import {
  IDEA_DIR,
  newMdFiles,
  oldestMd,
  ranTodayForRepo,
  readyDir,
  doneDir,
  failedDir,
  runsOncePerDay,
  sourceFor,
} from "./task-source";
import type { RunLogEntry } from "./run-log";

describe("sourceFor", () => {
  it("maps bugs/requirements to file-driven folders", () => {
    expect(sourceFor("bug")).toEqual({ base: "delivery/bugs", kind: "file" });
    expect(sourceFor("requirement")).toEqual({
      base: "delivery/requirements",
      kind: "file",
    });
  });
  it("maps reviews/doku to recurring (no folder)", () => {
    expect(sourceFor("code-review").kind).toBe("recurring");
    expect(sourceFor("doku").kind).toBe("recurring");
  });
  it("unknown type defaults to recurring", () => {
    expect(sourceFor("whatever").kind).toBe("recurring");
  });

  // req-011: "ideen" was missing from this map entirely, so the Ideen task ran
  // as an unknown type — recurring, without a folder, with the review prompt.
  it("maps ideen to the idea folder of the repo", () => {
    expect(sourceFor("ideen")).toEqual({ base: IDEA_DIR, kind: "idea" });
    expect(IDEA_DIR).toBe("delivery/idea");
  });

  // req-014: Security is its own kind — no work-item folder, and a report only
  // when there is a finding.
  it("maps security to its own kind, without a work-item folder", () => {
    expect(sourceFor("security")).toEqual({ base: null, kind: "security" });
  });
});

describe("runsOncePerDay", () => {
  it("is true for recurring, idea and security types, false for file-driven ones", () => {
    expect(runsOncePerDay(sourceFor("ideen"))).toBe(true);
    expect(runsOncePerDay(sourceFor("code-review"))).toBe(true);
    expect(runsOncePerDay(sourceFor("security"))).toBe(true);
    expect(runsOncePerDay(sourceFor("bug"))).toBe(false);
    expect(runsOncePerDay(sourceFor("requirement"))).toBe(false);
  });
});

describe("folder helpers", () => {
  it("build ready/done/failed paths", () => {
    expect(readyDir("delivery/bugs")).toBe("delivery/bugs/ready");
    expect(doneDir("delivery/bugs")).toBe("delivery/bugs/done");
    expect(failedDir("delivery/bugs")).toBe("delivery/bugs/failed");
  });

  it("puts implemented ideas under done/ (req-011)", () => {
    expect(doneDir(IDEA_DIR)).toBe("delivery/idea/done");
  });
});

// req-011: whether a run proposed an idea is decided by the folder, not by
// Claude's wording.
describe("newMdFiles", () => {
  it("returns the .md files that were not there before", () => {
    expect(newMdFiles(["csv-export.md"], ["csv-export.md", "dark-mode.md"])).toEqual(
      ["dark-mode.md"],
    );
  });
  it("is empty when nothing was added", () => {
    expect(newMdFiles(["csv-export.md"], ["csv-export.md"])).toEqual([]);
  });
  it("ignores the done/ folder and non-md entries", () => {
    expect(newMdFiles([], ["done", ".gitkeep", "notizen.txt"])).toEqual([]);
  });
  it("sorts, so the message is stable", () => {
    expect(newMdFiles([], ["b.md", "a.md"])).toEqual(["a.md", "b.md"]);
  });
});

describe("oldestMd", () => {
  it("returns the alphabetically-first .md (req-001 before req-002)", () => {
    expect(oldestMd(["req-002-b.md", "req-001-a.md", "notes.txt"])).toBe(
      "req-001-a.md",
    );
  });
  it("ignores non-md files", () => {
    expect(oldestMd(["a.txt", "b.json"])).toBeNull();
  });
  it("null when empty", () => {
    expect(oldestMd([])).toBeNull();
  });
});

describe("ranTodayForRepo", () => {
  const now = new Date(2026, 6, 24, 15, 0, 0);
  const mk = (
    repo: string,
    taskType: string,
    status: RunLogEntry["status"],
    day: number,
  ): RunLogEntry => ({
    id: 1,
    startedAt: new Date(2026, 6, day, 10, 0).toISOString(),
    endedAt: new Date(2026, 6, day, 10, 0).toISOString(),
    repo,
    taskType,
    status,
    message: "",
  });

  it("true when a matching success is on the same day", () => {
    expect(
      ranTodayForRepo([mk("appbaua", "Code-Review", "success", 24)], "appbaua", "Code-Review", now),
    ).toBe(true);
  });
  it("false when the success was yesterday", () => {
    expect(
      ranTodayForRepo([mk("appbaua", "Code-Review", "success", 23)], "appbaua", "Code-Review", now),
    ).toBe(false);
  });
  it("false for a different repo or type", () => {
    expect(
      ranTodayForRepo([mk("worker", "Code-Review", "success", 24)], "appbaua", "Code-Review", now),
    ).toBe(false);
  });
  it("an error today does not count as 'ran'", () => {
    expect(
      ranTodayForRepo([mk("appbaua", "Code-Review", "error", 24)], "appbaua", "Code-Review", now),
    ).toBe(false);
  });
});
