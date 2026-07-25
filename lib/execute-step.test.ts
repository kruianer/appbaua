import { describe, it, expect, vi } from "vitest";
import { executeStep, type ExecuteDeps } from "./execute-step";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";
import type { RunLogEntry } from "./run-log";

const repo: Repo = { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true };
const bug = defaultTaskTypes().find((t) => t.id === "bug")!;
const review = defaultTaskTypes().find((t) => t.id === "code-review")!;
const now = new Date(2026, 6, 24, 15, 0, 0);

/**
 * Folder-aware fake for listReady: a step looks into in-progress/ (leftovers of
 * a crashed run, req-008) and ready/ (the actual work), so the fake has to tell
 * them apart.
 */
function folders(contents: { ready?: string[]; inProgress?: string[] } = {}) {
  return vi.fn(async (_dir: string, rel: string) => {
    if (rel.endsWith("/in-progress")) return contents.inProgress ?? [];
    if (rel.endsWith("/ready")) return contents.ready ?? [];
    return [];
  });
}

/** Typed fake for the report writer (req-010), so mock.calls stays inspectable. */
function writerFake() {
  return vi.fn(async (_dir: string, _rel: string, _content: string) => {});
}

function deps(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
  return {
    token: "tok",
    now: () => now,
    prepareRepo: vi.fn(async () => "/work/appbaua"),
    listReady: folders(),
    runClaude: vi.fn(async () => ({ ok: true, summary: "done", report: "" })),
    commitAndPush: vi.fn(async () => ({ pushed: true, detail: "auf dev gepusht" })),
    moveMd: vi.fn(async () => {}),
    headCommit: vi.fn(async (_dir: string) => "282a765"),
    writeRepoFile: writerFake(),
    setCurrentMd: vi.fn(async (_md: string | null) => {}),
    setCurrentOutput: vi.fn(async (_text: string | null) => {}),
    ...over,
  };
}

describe("executeStep (req-006)", () => {
  it("errors when no token is configured", async () => {
    const d = await executeStep(repo, bug, [], deps({ token: undefined }));
    expect(d.kind).toBe("error");
  });

  it("file-driven, empty ready/ -> skip (no work)", async () => {
    const d = await executeStep(repo, bug, [], deps({ listReady: folders() }));
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
        listReady: folders({ ready: ["bug-002.md", "bug-001.md"] }),
        moveMd,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("success");
    // oldest (bug-001) claimed into in-progress, then filed under done
    expect(moveMd).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/bug-001.md",
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
        listReady: folders({ ready: ["bug-001.md"] }),
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
        moveMd,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    expect(moveMd).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/bug-001.md",
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
    const runClaude = vi.fn(async () => ({ ok: true, summary: "review done", report: "" }));
    const d = await executeStep(repo, review, [], deps({ runClaude }));
    expect(d.kind).toBe("success");
    expect(runClaude).toHaveBeenCalled();
  });
});

describe("executeStep — in-progress folder (req-008)", () => {
  it("AC: the .md is moved ready/ -> in-progress/ before Claude starts", async () => {
    const calls: string[] = [];
    const moveMd = vi.fn(async (_d: string, from: string, to: string) => {
      calls.push(`move ${from} -> ${to}`);
    });
    const runClaude = vi.fn(async () => {
      calls.push("claude");
      return { ok: true, summary: "done", report: "" };
    });
    await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: folders({ ready: ["bug-001.md"] }), moveMd, runClaude }),
    );
    expect(calls[0]).toBe(
      "move delivery/bugs/ready/bug-001.md -> delivery/bugs/in-progress/bug-001.md",
    );
    expect(calls[1]).toBe("claude");
  });

  it("hands Claude the in-progress path, because that is where the file is", async () => {
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "done", report: "" };
    });
    await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: folders({ ready: ["bug-001.md"] }), runClaude }),
    );
    expect(seenPrompt).toContain("delivery/bugs/in-progress/bug-001.md");
  });

  it("AC: a .md left in in-progress/ by an interrupted run goes back to ready/", async () => {
    const moveMd = vi.fn(async () => {});
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: [], inProgress: ["req-abgestuerzt.md"] }),
        moveMd,
      }),
    );
    expect(moveMd).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/req-abgestuerzt.md",
      "delivery/bugs/ready/req-abgestuerzt.md",
    );
  });

  it("requeues leftovers but ignores non-md files", async () => {
    const moveMd = vi.fn(async () => {});
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ inProgress: ["notizen.txt", ".gitkeep"] }),
        moveMd,
      }),
    );
    expect(moveMd).not.toHaveBeenCalled();
  });

  it("a failing requeue does not stop the step", async () => {
    const moveMd = vi.fn(async (_d: string, from: string) => {
      if (from.includes("/in-progress/alt.md")) throw new Error("weg");
    });
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["bug-001.md"], inProgress: ["alt.md"] }),
        moveMd,
      }),
    );
    expect(d.kind).toBe("success");
  });

  it("a failing claim (ready -> in-progress) becomes a logged error, no Claude run", async () => {
    const runClaude = vi.fn(async () => ({ ok: true, summary: "done", report: "" }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["bug-001.md"] }),
        moveMd: vi.fn(async () => {
          throw new Error("kein Platz");
        }),
        runClaude,
      }),
    );
    expect(d.kind).toBe("error");
    expect(runClaude).not.toHaveBeenCalled();
  });

  it("recurring types touch no folders at all", async () => {
    const moveMd = vi.fn(async () => {});
    const listReady = folders();
    await executeStep(repo, review, [], deps({ moveMd, listReady }));
    expect(listReady).not.toHaveBeenCalled();
    expect(moveMd).not.toHaveBeenCalled();
  });
});

describe("executeStep — live status (req-008)", () => {
  it("AC: publishes the name of the .md being worked on", async () => {
    const setCurrentMd = vi.fn(async (_md: string | null) => {});
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["req-042-beispiel.md"] }),
        setCurrentMd,
      }),
    );
    expect(setCurrentMd).toHaveBeenCalledWith("req-042-beispiel.md");
  });

  it("AC: a recurring type publishes no .md name", async () => {
    const setCurrentMd = vi.fn(async (_md: string | null) => {});
    await executeStep(repo, review, [], deps({ setCurrentMd }));
    expect(setCurrentMd).not.toHaveBeenCalled();
  });

  it("AC: the running Claude output is published live", async () => {
    const setCurrentOutput = vi.fn(async (_text: string | null) => {});
    const runClaude = vi.fn(
      async (
        _dir: string,
        _prompt: string,
        o?: { onOutput?: (tail: string) => void },
      ) => {
        o?.onOutput?.("Zeile 1");
        o?.onOutput?.("Zeile 1\nZeile 2");
        return { ok: true, summary: "done", report: "" };
      },
    );
    await executeStep(repo, review, [], deps({ runClaude, setCurrentOutput }));
    expect(setCurrentOutput.mock.calls.map((c) => c[0])).toEqual([
      "Zeile 1",
      "Zeile 1\nZeile 2",
    ]);
  });

  it("all live-output writes are finished before the step returns", async () => {
    let inFlight = 0;
    let maxSeenAfterReturn = 0;
    const setCurrentOutput = vi.fn(async (_text: string | null) => {
      inFlight += 1;
      await Promise.resolve();
      inFlight -= 1;
    });
    const runClaude = vi.fn(
      async (
        _dir: string,
        _prompt: string,
        o?: { onOutput?: (tail: string) => void },
      ) => {
        o?.onOutput?.("a");
        o?.onOutput?.("b");
        return { ok: true, summary: "done", report: "" };
      },
    );
    await executeStep(repo, review, [], deps({ runClaude, setCurrentOutput }));
    maxSeenAfterReturn = inFlight;
    expect(maxSeenAfterReturn).toBe(0);
    expect(setCurrentOutput).toHaveBeenCalledTimes(2);
  });

  it("a failing status write never breaks the step", async () => {
    const d = await executeStep(
      repo,
      review,
      [],
      deps({
        setCurrentOutput: vi.fn(async (_text: string | null) => {
          throw new Error("DB weg");
        }),
        runClaude: vi.fn(
          async (
            _dir: string,
            _prompt: string,
            o?: { onOutput?: (tail: string) => void },
          ) => {
            o?.onOutput?.("etwas");
            return { ok: true, summary: "done", report: "" };
          },
        ),
      }),
    );
    expect(d.kind).toBe("success");
  });
});

// req-010: a recurring analysis task (Code-Review, Security-Review, Doku) has
// no work item to commit — its result is a report, which has to survive the
// throwaway Claude session as a file in the target repo.
describe("executeStep — Bericht ablegen (req-010)", () => {
  const REPORT = "# Code-Review\n\nBefund 1: sehr ausführlich …\nBefund 2: …";
  const REPORT_FILE =
    "delivery/reviews/2026-07-24-code-review-appbaua-282a765.md";

  function reviewDeps(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
    return deps({
      runClaude: vi.fn(async () => ({
        ok: true,
        summary: "Fazit: alles gut.",
        report: REPORT,
      })),
      ...over,
    });
  }

  it("AC: a successful recurring run writes the full report into the repo", async () => {
    const writeRepoFile = writerFake();
    const d = await executeStep(repo, review, [], reviewDeps({ writeRepoFile }));
    expect(d.kind).toBe("success");
    expect(writeRepoFile).toHaveBeenCalledTimes(1);
    const [dir, rel, content] = writeRepoFile.mock.calls[0];
    expect(dir).toBe("/work/appbaua");
    expect(rel).toBe(REPORT_FILE);
    expect(content).toContain(REPORT); // the FULL report, not the short message
  });

  it("AC: the filename names type, date and reference (repo + commit)", async () => {
    const writeRepoFile = writerFake();
    await executeStep(repo, review, [], reviewDeps({ writeRepoFile }));
    const rel = writeRepoFile.mock.calls[0][1];
    expect(rel).toContain("code-review"); // Typ
    expect(rel).toContain("2026-07-24"); // Datum
    expect(rel).toContain("appbaua"); // Repo
    expect(rel).toContain("282a765"); // Commit
  });

  it("AC: the report is written first, then committed and pushed on dev", async () => {
    // Order matters: a report written after the commit would never be pushed.
    const order: string[] = [];
    const writeRepoFile = vi.fn(async (_d: string, _r: string, _c: string) => {
      order.push("write");
    });
    const commitAndPush = vi.fn(async () => {
      order.push("push");
      return { pushed: true, detail: "auf dev gepusht" };
    });
    const d = await executeStep(
      repo,
      review,
      [],
      reviewDeps({ commitAndPush, writeRepoFile }),
    );
    expect(order).toEqual(["write", "push"]);
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain("auf dev gepusht");
  });

  it("AC: the log keeps the short message, not the full report", async () => {
    const long = `${"x".repeat(5000)}\nFazit: alles gut.`;
    const d = await executeStep(
      repo,
      review,
      [],
      reviewDeps({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "Fazit: alles gut.",
          report: long,
        })),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).not.toContain(long);
    expect(d.message).toContain("Fazit: alles gut.");
    expect(d.message.length).toBeLessThan(500);
  });

  it("the short message names the report file, so it stays findable", async () => {
    const d = await executeStep(repo, review, [], reviewDeps());
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain(REPORT_FILE);
  });

  it("file-driven tasks file no report — they commit code (out of scope)", async () => {
    const writeRepoFile = writerFake();
    const d = await executeStep(
      repo,
      bug,
      [],
      reviewDeps({ listReady: folders({ ready: ["bug-001.md"] }), writeRepoFile }),
    );
    expect(d.kind).toBe("success");
    expect(writeRepoFile).not.toHaveBeenCalled();
  });

  it("a failed Claude run files no report", async () => {
    const writeRepoFile = writerFake();
    const d = await executeStep(
      repo,
      review,
      [],
      reviewDeps({
        runClaude: vi.fn(async () => ({
          ok: false,
          summary: "Timeout",
          report: "",
        })),
        writeRepoFile,
      }),
    );
    expect(d.kind).toBe("error");
    expect(writeRepoFile).not.toHaveBeenCalled();
  });

  it("an empty report writes no file", async () => {
    const writeRepoFile = writerFake();
    await executeStep(
      repo,
      review,
      [],
      reviewDeps({
        runClaude: vi.fn(async () => ({ ok: true, summary: "ok", report: "   " })),
        writeRepoFile,
      }),
    );
    expect(writeRepoFile).not.toHaveBeenCalled();
  });

  it("an undeterminable commit still produces a report file", async () => {
    const writeRepoFile = writerFake();
    await executeStep(
      repo,
      review,
      [],
      reviewDeps({ headCommit: vi.fn(async () => null), writeRepoFile }),
    );
    expect(writeRepoFile.mock.calls[0][1]).toBe(
      "delivery/reviews/2026-07-24-code-review-appbaua.md",
    );
  });

  it("a failing write never turns a successful review into an error", async () => {
    const d = await executeStep(
      repo,
      review,
      [],
      reviewDeps({
        writeRepoFile: vi.fn(async () => {
          throw new Error("Platte voll");
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).not.toContain("Bericht:");
  });
});
