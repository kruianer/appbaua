import { describe, it, expect } from "vitest";
import {
  oldestMd,
  ranTodayForRepo,
  readyDir,
  doneDir,
  failedDir,
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
});

describe("folder helpers", () => {
  it("build ready/done/failed paths", () => {
    expect(readyDir("delivery/bugs")).toBe("delivery/bugs/ready");
    expect(doneDir("delivery/bugs")).toBe("delivery/bugs/done");
    expect(failedDir("delivery/bugs")).toBe("delivery/bugs/failed");
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
