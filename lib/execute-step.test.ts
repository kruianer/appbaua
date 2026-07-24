import { describe, it, expect, vi } from "vitest";
import { executeStep, type ExecuteDeps } from "./execute-step";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";
import type { RunLogEntry } from "./run-log";

const repo: Repo = { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true };
const bug = defaultTaskTypes().find((t) => t.id === "bug")!;
const review = defaultTaskTypes().find((t) => t.id === "code-review")!;
const now = new Date(2026, 6, 24, 15, 0, 0);

function deps(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
  return {
    token: "tok",
    now: () => now,
    prepareRepo: vi.fn(async () => "/work/appbaua"),
    listReady: vi.fn(async () => []),
    runClaude: vi.fn(async () => ({ ok: true, summary: "done" })),
    commitAndPush: vi.fn(async () => ({ pushed: true, detail: "auf dev gepusht" })),
    moveMd: vi.fn(async () => {}),
    ...over,
  };
}

describe("executeStep (req-006)", () => {
  it("errors when no token is configured", async () => {
    const d = await executeStep(repo, bug, [], deps({ token: undefined }));
    expect(d.kind).toBe("error");
  });

  it("file-driven, empty ready/ -> skip (no work)", async () => {
    const d = await executeStep(repo, bug, [], deps({ listReady: vi.fn(async () => []) }));
    expect(d.kind).toBe("skip");
  });

  it("file-driven success -> md moved to done, pushed", async () => {
    const moveMd = vi.fn(async () => {});
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "auf dev gepusht" }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: vi.fn(async () => ["bug-002.md", "bug-001.md"]),
        moveMd,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("success");
    // oldest (bug-001) moved from ready to done
    expect(moveMd).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/bugs/ready/bug-001.md",
      "delivery/bugs/done/bug-001.md",
    );
    expect(commitAndPush).toHaveBeenCalled();
  });

  it("file-driven claude failure -> md moved to failed, NOT pushed", async () => {
    const moveMd = vi.fn(async () => {});
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: vi.fn(async () => ["bug-001.md"]),
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout" })),
        moveMd,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    expect(moveMd).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/bugs/ready/bug-001.md",
      "delivery/bugs/failed/bug-001.md",
    );
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("recurring type already ran today -> skip", async () => {
    const ranToday: RunLogEntry[] = [
      {
        id: 1,
        startedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        endedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        repo: "appbaua",
        taskType: "Code-Review",
        status: "success",
        message: "",
      },
    ];
    const prepareRepo = vi.fn(async () => "/work/appbaua");
    const d = await executeStep(repo, review, ranToday, deps({ prepareRepo }));
    expect(d.kind).toBe("skip");
    expect(prepareRepo).not.toHaveBeenCalled(); // skipped before cloning
  });

  it("recurring type not run today -> runs and pushes", async () => {
    const runClaude = vi.fn(async () => ({ ok: true, summary: "review done" }));
    const d = await executeStep(repo, review, [], deps({ runClaude }));
    expect(d.kind).toBe("success");
    expect(runClaude).toHaveBeenCalled();
  });
});
