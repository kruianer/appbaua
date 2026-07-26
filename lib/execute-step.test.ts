import { describe, it, expect, vi } from "vitest";
import {
  PREPARE_FAILED_MESSAGE,
  PUSH_FAILED_MESSAGE,
  executeStep,
  type ExecuteDeps,
  type StepDecision,
} from "./execute-step";
import { defaultTaskTypes } from "./task-types";
import type { Repo } from "./repos";
import { type RunLogEntry, RECURRING_MD } from "./run-log";
import {
  DOC_UNCHANGED_MESSAGE,
  NO_DESIGN_MESSAGE,
  USER_DOCS_DIR,
} from "./doc-site";
import {
  NO_DEV_URL_MESSAGE,
  SCREENSHOT_DIR,
  type ShotResult,
} from "./doc-screenshots";
import { NO_CHANGES_DETAIL } from "./workspace";
import {
  GATE_GREEN_MESSAGE,
  GATE_RED_MESSAGE,
  NO_TEST_COMMAND_MESSAGE,
  STACK_FILE,
  type TestGateResult,
} from "./test-gate";

const repo: Repo = { id: "r1", name: "appbaua", url: "github.com/kruianer/appbaua", active: true };
const bug = defaultTaskTypes().find((t) => t.id === "bug")!;
const review = defaultTaskTypes().find((t) => t.id === "code-review")!;
const ideen = defaultTaskTypes().find((t) => t.id === "ideen")!;
const security = defaultTaskTypes().find((t) => t.id === "security")!;
const doku = defaultTaskTypes().find((t) => t.id === "doku")!;
const now = new Date(2026, 6, 24, 15, 0, 0);

/**
 * What prepareRepo hands back since req-020: the working copy AND the branch
 * the target repo's own devops.md put the worker on. `dev` here, because that
 * is what a standard repo says — the req-020 tests below say otherwise.
 */
const PREPARED = { dir: "/work/appbaua", branch: "dev" };

/** How every commit of a step is made since req-020: onto that branch. */
const ON = (branch = "dev") => ({ branch });

/**
 * A repo that HAS a design template (req-016): doc-site.md names one and the
 * folder is there. The default deps below use it, so a Doku test only says so
 * when it wants the other case.
 */
const DOC_SITE_MD = [
  "# Doku-Site-Vorgaben",
  "",
  "## Design-Vorlage",
  "",
  "- Ort: delivery/doc-design/",
].join("\n");

/** The repo's devops.md, which is where the Doku task reads the dev URL (req-017). */
const DEVOPS_MD = [
  "# DevOps Convention",
  "",
  "## Environments",
  "",
  "| Environment | Branch | URL                     |",
  "|-------------|--------|-------------------------|",
  "| dev         | dev    | https://dev.appbaua.com |",
  "| prod        | main   | https://app.appbaua.com |",
].join("\n");

/**
 * Default for the screenshot dep: a run that photographed nothing at all, so the
 * tests that predate req-017 keep seeing exactly the messages they asserted.
 * Every req-017 test says what it wants instead.
 */
const noShots = (): ShotResult => ({ shot: [], missing: [] });

/** Default for the test-gate dep (req-019): the suite ran and passed. */
const green = (): TestGateResult => ({
  status: "green",
  command: "npm test",
  reason: "",
});

/** A gate that came back red, with the cause the Verlauf has to carry. */
const red = (reason: string): TestGateResult => ({
  status: "red",
  command: "npm test",
  reason,
});

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
    prepareRepo: vi.fn(async () => PREPARED),
    listReady: folders(),
    runClaude: vi.fn(async () => ({ ok: true, summary: "done", report: "" })),
    commitAndPush: vi.fn(async () => ({ pushed: true, detail: "auf dev gepusht" })),
    moveMd: vi.fn(async () => {}),
    discardChanges: vi.fn(async (_dir: string) => {}),
    headCommit: vi.fn(async (_dir: string) => "282a765"),
    writeRepoFile: writerFake(),
    readRepoFile: vi.fn(async (_dir: string, rel: string) => {
      if (rel === "delivery/doc-site.md") return DOC_SITE_MD;
      if (rel === "delivery/devops.md") return DEVOPS_MD;
      return null;
    }),
    repoPathExists: vi.fn(async (_dir: string, _rel: string) => true),
    captureScreenshots: vi.fn(async (_dir: string, _url: string | null) => noShots()),
    // Green by default (req-019), so every test that predates the gate keeps
    // asserting what it always asserted. The req-019 tests say what they want.
    runTestGate: vi.fn(async (_dir: string, _stack: string | null) => green()),
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

  it("file-driven claude failure -> md moved to failed and pushed (bug-002)", async () => {
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
    expect(moveMd).toHaveBeenLastCalledWith(
      "/work/appbaua",
      "delivery/bugs/ready/bug-001.md",
      "delivery/bugs/failed/bug-001.md",
    );
    expect(commitAndPush).toHaveBeenCalled();
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
    const prepareRepo = vi.fn(async () => PREPARED);
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

// req-015: the decision carries the .md out, so the loop can put it on the log
// entry and the Verlauf can name the file the run worked off.
describe("executeStep — .md für den Verlauf (req-015)", () => {
  /** The md of a decision that is not a skip. */
  const mdOf = (d: StepDecision) => (d.kind === "skip" ? undefined : d.md);

  it("AC: a file-driven step names the .md it worked off", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: folders({ ready: ["bug-002.md", "bug-001.md"] }) }),
    );
    expect(d.kind).toBe("success");
    expect(mdOf(d)).toBe("bug-001.md"); // the oldest one, the one it claimed
  });

  it("AC: a recurring step reports that it has no .md", async () => {
    const d = await executeStep(repo, review, [], deps());
    expect(d.kind).toBe("success");
    expect(mdOf(d)).toBe(RECURRING_MD);
  });

  it("the Ideen, Security and Doku tasks report it the same way", async () => {
    const idea = await executeStep(repo, ideen, [], deps());
    expect(mdOf(idea)).toBe(RECURRING_MD);

    const sec = await executeStep(repo, security, [], deps());
    expect(mdOf(sec)).toBe(RECURRING_MD);

    const doc = await executeStep(repo, doku, [], deps());
    expect(mdOf(doc)).toBe(RECURRING_MD);
  });

  it("a failed run still names the .md it tried", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["bug-001.md"] }),
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
      }),
    );
    expect(d.kind).toBe("error");
    expect(mdOf(d)).toBe("bug-001.md");
  });

  it("a file-driven step that broke off before claiming names no file", async () => {
    // Nothing was worked on, so the Verlauf must not claim otherwise.
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        prepareRepo: vi.fn(async () => {
          throw new Error("Repo weg");
        }),
      }),
    );
    expect(d.kind).toBe("error");
    expect(mdOf(d)).toBeNull();
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

// bug-002: a .md whose run failed used to be moved to failed/ locally only.
// The next prepareRepo reset ready/ back from origin, so the same task was
// retried forever while the untracked failed/ copy waited to be swept into an
// unrelated commit — leaving the file in ready/ AND failed/ at once.
describe("executeStep — fehlgeschlagene .md wird persistiert (bug-002)", () => {
  const timeout = () =>
    vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" }));

  function failingDeps(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
    return deps({
      listReady: folders({ ready: ["bug-001.md"] }),
      runClaude: timeout(),
      ...over,
    });
  }

  it("AC: the failed .md is committed and pushed under failed/", async () => {
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(repo, bug, [], failingDeps({ commitAndPush }));
    expect(d.kind).toBe("error");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: bug-001.md fehlgeschlagen",
      "tok", // the push needs the credential handed in now (bug-003)
      ON(), // …and the repo's own branch since req-020
    );
  });

  it("AC: the move starts in ready/, so the .md is not in ready/ AND failed/", async () => {
    // The commit has to record both halves of the move. Moving out of
    // in-progress/ would only ADD failed/bug-001.md while ready/bug-001.md
    // stayed untouched in the index.
    const order: string[] = [];
    const d = await executeStep(
      repo,
      bug,
      [],
      failingDeps({
        discardChanges: vi.fn(async (_dir: string) => {
          order.push("discard");
        }),
        moveMd: vi.fn(async (_dir: string, from: string, to: string) => {
          order.push(`move ${from} -> ${to}`);
        }),
        commitAndPush: vi.fn(async () => {
          order.push("push");
          return { pushed: true, detail: "auf dev gepusht" };
        }),
      }),
    );
    expect(d.kind).toBe("error");
    expect(order).toEqual([
      "move delivery/bugs/ready/bug-001.md -> delivery/bugs/in-progress/bug-001.md",
      // everything the failed attempt left behind goes first — the commit must
      // carry the move and nothing else
      "discard",
      "move delivery/bugs/ready/bug-001.md -> delivery/bugs/failed/bug-001.md",
      "push",
    ]);
  });

  it("the run log says where the .md went", async () => {
    const d = await executeStep(repo, bug, [], failingDeps());
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Timeout"); // the original failure stays
    expect(d.message).toContain("bug-001.md nach failed/ verschoben");
    expect(d.message).toContain("auf dev gepusht");
  });

  it("a push that fails is reported, but stays one 'error' step", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      failingDeps({
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: "push failed: keine Rechte",
        })),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("push failed: keine Rechte");
  });

  it("a move that fails never hides the original error", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      failingDeps({
        moveMd: vi.fn(async (_dir: string, _from: string, to: string) => {
          if (to.includes("/failed/")) throw new Error("weg");
        }),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Timeout");
    expect(d.message).toContain("konnte nicht nach failed/ verschoben werden");
  });

  it("a recurring type has no .md to park and pushes nothing", async () => {
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const discardChanges = vi.fn(async (_dir: string) => {});
    const d = await executeStep(
      repo,
      review,
      [],
      deps({ runClaude: timeout(), commitAndPush, discardChanges }),
    );
    expect(d.kind).toBe("error");
    expect(commitAndPush).not.toHaveBeenCalled();
    expect(discardChanges).not.toHaveBeenCalled();
  });

  it("a successful step discards nothing — its work is what gets committed", async () => {
    const discardChanges = vi.fn(async (_dir: string) => {});
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["bug-001.md"] }),
        discardChanges,
      }),
    );
    expect(d.kind).toBe("success");
    expect(discardChanges).not.toHaveBeenCalled();
  });
});

// req-011: the Ideen task. Once per repo and calendar day, Claude proposes
// exactly one new idea as a file in delivery/idea/. Whether it did is read off
// the folder, not off its answer.
describe("executeStep — Ideen-Task (req-011)", () => {
  /**
   * Fake for the idea folder: the listing before the Claude run and the one
   * after it. The step reads that difference to decide what happened.
   */
  function ideaFolder(before: string[], after: string[]) {
    let calls = 0;
    return vi.fn(async (_dir: string, rel: string) => {
      if (rel !== "delivery/idea") return [];
      calls += 1;
      return calls === 1 ? before : after;
    });
  }

  /** Claude run that writes one new idea file into the working copy. */
  function proposes(before: string[], name: string) {
    return ideaFolder(before, [...before, name]);
  }

  it("AC: a new idea file is created and pushed on dev", async () => {
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      ideen,
      [],
      deps({ listReady: proposes([], "dark-mode.md"), commitAndPush }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain("dark-mode.md");
    expect(d.message).toContain("auf dev gepusht");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: neue Idee dark-mode.md",
      "tok",
      ON(),
    );
  });

  it("AC: a second run on the same calendar day is skipped", async () => {
    const ranToday: RunLogEntry[] = [
      {
        id: 1,
        startedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        endedAt: new Date(2026, 6, 24, 9, 5).toISOString(),
        repo: "appbaua",
        taskType: "Ideen",
        status: "success",
        message: "Neue Idee: dark-mode.md — auf dev gepusht",
      },
    ];
    const prepareRepo = vi.fn(async () => PREPARED);
    const d = await executeStep(repo, ideen, ranToday, deps({ prepareRepo }));
    expect(d.kind).toBe("skip");
    expect(prepareRepo).not.toHaveBeenCalled(); // skipped before cloning
  });

  it("a run for another repo does not use up this repo's day", async () => {
    const ranElsewhere: RunLogEntry[] = [
      {
        id: 1,
        startedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        endedAt: new Date(2026, 6, 24, 9, 5).toISOString(),
        repo: "anderes-repo",
        taskType: "Ideen",
        status: "success",
        message: "",
      },
    ];
    const d = await executeStep(
      repo,
      ideen,
      ranElsewhere,
      deps({ listReady: proposes([], "dark-mode.md") }),
    );
    expect(d.kind).toBe("success");
  });

  it("AC: the existing and the implemented ideas plus the direction reach Claude", async () => {
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "vorgeschlagen", report: "" };
    });
    await executeStep(
      repo,
      ideen,
      [],
      deps({ listReady: proposes(["csv-export.md"], "dark-mode.md"), runClaude }),
    );
    expect(seenPrompt).toContain("delivery/idea/");
    expect(seenPrompt).toContain("delivery/idea/done/");
    expect(seenPrompt).toContain("delivery/idea-direction.md");
    expect(seenPrompt).toContain("Dublette");
  });

  it("AC: no new idea -> nothing is committed and the log says so", async () => {
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const discardChanges = vi.fn(async (_dir: string) => {});
    const d = await executeStep(
      repo,
      ideen,
      [],
      deps({
        listReady: ideaFolder(["csv-export.md"], ["csv-export.md"]),
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "keine neue Idee gefunden",
          report: "",
        })),
        commitAndPush,
        discardChanges,
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe("keine neue Idee gefunden");
    expect(commitAndPush).not.toHaveBeenCalled();
    expect(discardChanges).toHaveBeenCalledWith("/work/appbaua"); // nothing half-done reaches dev
  });

  it("AC: an empty-handed run still uses up the day", async () => {
    // "keine neue Idee gefunden" is a success, so ranTodayForRepo sees it and
    // the next pass of the same day skips.
    const empty = await executeStep(
      repo,
      ideen,
      [],
      deps({ listReady: ideaFolder([], []) }),
    );
    expect(empty.kind).toBe("success");
    if (empty.kind !== "success") return;
    const log: RunLogEntry[] = [
      {
        id: 1,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        repo: "appbaua",
        taskType: "Ideen",
        status: "success",
        message: empty.message,
      },
    ];
    expect((await executeStep(repo, ideen, log, deps())).kind).toBe("skip");
  });

  it("an overwritten existing idea does not count as a new one", async () => {
    // Rewriting csv-export.md leaves the folder unchanged — no proposal.
    const d = await executeStep(
      repo,
      ideen,
      [],
      deps({ listReady: ideaFolder(["csv-export.md"], ["csv-export.md"]) }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe("keine neue Idee gefunden");
  });

  it("files no review report — the idea file is the result (req-010 stays untouched)", async () => {
    const writeRepoFile = writerFake();
    await executeStep(
      repo,
      ideen,
      [],
      deps({
        listReady: proposes([], "dark-mode.md"),
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "vorgeschlagen",
          report: "# Ein langer Bericht",
        })),
        writeRepoFile,
      }),
    );
    expect(writeRepoFile).not.toHaveBeenCalled();
  });

  it("claims no .md — the Ideen task has no work-item queue", async () => {
    const moveMd = vi.fn(async () => {});
    const setCurrentMd = vi.fn(async (_md: string | null) => {});
    await executeStep(
      repo,
      ideen,
      [],
      deps({ listReady: proposes([], "dark-mode.md"), moveMd, setCurrentMd }),
    );
    expect(moveMd).not.toHaveBeenCalled();
    expect(setCurrentMd).not.toHaveBeenCalled();
  });

  it("a failed Claude run stays an error and commits nothing", async () => {
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      ideen,
      [],
      deps({
        listReady: proposes([], "dark-mode.md"),
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Timeout");
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("a push that fails is an error since req-020, not a quiet success", async () => {
    const d = await executeStep(
      repo,
      ideen,
      [],
      deps({
        listReady: proposes([], "dark-mode.md"),
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: "push failed: keine Rechte",
        })),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("push failed: keine Rechte");
  });
});

// req-014: the Security task. Once per repo and calendar day it checks the repo
// against delivery/security.md, changes nothing, and files a report in
// delivery/security/ — but only when it found something.
describe("executeStep — Security-Task (req-014)", () => {
  const FINDINGS = [
    "## Zusammenfassung",
    "",
    "Zwei Abweichungen von den Vorgaben.",
    "",
    "### 1. Port 3000 von außen erreichbar (Schweregrad: hoch)",
    "",
    "Empfehlung: Firewall-Regel auf das WLAN begrenzen. Live verifiziert.",
  ].join("\n");
  const REPORT_FILE = "delivery/security/2026-07-24-security-appbaua-282a765.md";

  /** A check that came back with findings. */
  function found(over: Partial<ExecuteDeps> = {}): Partial<ExecuteDeps> {
    return deps({
      runClaude: vi.fn(async () => ({
        ok: true,
        summary: "2 Findings",
        report: FINDINGS,
      })),
      ...over,
    });
  }

  it("AC: a finding lands as a new file in delivery/security/ and is pushed on dev", async () => {
    const writeRepoFile = writerFake();
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      security,
      [],
      found({ writeRepoFile, commitAndPush }),
    );
    expect(d.kind).toBe("success");
    expect(writeRepoFile).toHaveBeenCalledTimes(1);
    const [dir, rel, content] = writeRepoFile.mock.calls[0];
    expect(dir).toBe("/work/appbaua");
    expect(rel).toBe(REPORT_FILE);
    expect(content).toContain(FINDINGS); // summary + findings verbatim
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: Security-Bericht abgelegt",
      "tok",
      ON(),
    );
    if (d.kind !== "success") return;
    expect(d.message).toContain("auf dev gepusht");
    expect(d.message).toContain(REPORT_FILE); // findable from the Verlauf
  });

  it("AC: the filename names type, date and repo", async () => {
    const writeRepoFile = writerFake();
    await executeStep(repo, security, [], found({ writeRepoFile }));
    const rel = writeRepoFile.mock.calls[0][1];
    expect(rel).toContain("security"); // Typ
    expect(rel).toContain("2026-07-24"); // Datum
    expect(rel).toContain("appbaua"); // Repo
  });

  it("AC: a second run on the same calendar day is skipped", async () => {
    const ranToday: RunLogEntry[] = [
      {
        id: 1,
        startedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        endedAt: new Date(2026, 6, 24, 9, 20).toISOString(),
        repo: "appbaua",
        taskType: "Security",
        status: "success",
        message: "Security-Check ok",
      },
    ];
    const prepareRepo = vi.fn(async () => PREPARED);
    const d = await executeStep(repo, security, ranToday, deps({ prepareRepo }));
    expect(d.kind).toBe("skip");
    expect(prepareRepo).not.toHaveBeenCalled(); // skipped before cloning
  });

  it("AC: no finding -> no report file, and the log says 'Security-Check ok'", async () => {
    const writeRepoFile = writerFake();
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      security,
      [],
      deps({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "Security-Check ok",
          report: "Security-Check ok",
        })),
        writeRepoFile,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe("Security-Check ok");
    expect(writeRepoFile).not.toHaveBeenCalled();
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("AC: the security policy of the repo reaches the check", async () => {
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "ok", report: "Security-Check ok" };
    });
    await executeStep(repo, security, [], deps({ runClaude }));
    expect(seenPrompt).toContain("delivery/security.md");
    expect(seenPrompt).toContain("Zugriff & Erreichbarkeit");
    expect(seenPrompt).toContain("keine repo-spezifische Vorgabe vorlag");
  });

  it("changes no code: everything the run touched is dropped before the report", async () => {
    const order: string[] = [];
    await executeStep(
      repo,
      security,
      [],
      found({
        discardChanges: vi.fn(async (_dir: string) => {
          order.push("discard");
        }),
        writeRepoFile: vi.fn(async (_d: string, _r: string, _c: string) => {
          order.push("write");
        }),
        commitAndPush: vi.fn(async () => {
          order.push("push");
          return { pushed: true, detail: "auf dev gepusht" };
        }),
      }),
    );
    expect(order).toEqual(["discard", "write", "push"]);
  });

  it("an empty-handed check still uses up the day", async () => {
    const clean = await executeStep(repo, security, [], deps());
    expect(clean.kind).toBe("success");
    if (clean.kind !== "success") return;
    const log: RunLogEntry[] = [
      {
        id: 1,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        repo: "appbaua",
        taskType: "Security",
        status: "success",
        message: clean.message,
      },
    ];
    expect((await executeStep(repo, security, log, deps())).kind).toBe("skip");
  });

  it("files nothing under delivery/reviews/ — Security has its own folder", async () => {
    const writeRepoFile = writerFake();
    await executeStep(repo, security, [], found({ writeRepoFile }));
    expect(writeRepoFile.mock.calls[0][1]).not.toContain("delivery/reviews");
  });

  it("claims no .md — the Security task has no work-item queue", async () => {
    const listReady = folders();
    const moveMd = vi.fn(async () => {});
    const setCurrentMd = vi.fn(async (_md: string | null) => {});
    await executeStep(
      repo,
      security,
      [],
      found({ listReady, moveMd, setCurrentMd }),
    );
    expect(listReady).not.toHaveBeenCalled();
    expect(moveMd).not.toHaveBeenCalled();
    expect(setCurrentMd).not.toHaveBeenCalled();
  });

  it("a failed Claude run stays an error and files nothing", async () => {
    const writeRepoFile = writerFake();
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      security,
      [],
      deps({
        runClaude: vi.fn(async () => ({
          ok: false,
          summary: "Timeout",
          report: "",
        })),
        writeRepoFile,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Timeout");
    expect(writeRepoFile).not.toHaveBeenCalled();
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("a failing write never turns a clean run into an error", async () => {
    const d = await executeStep(
      repo,
      security,
      [],
      found({
        writeRepoFile: vi.fn(async () => {
          throw new Error("Platte voll");
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).not.toContain("Bericht:");
  });

  it("the log keeps the short message, not the whole report", async () => {
    const long = `${"x".repeat(5000)}\nFazit: 2 Findings.`;
    const d = await executeStep(
      repo,
      security,
      [],
      found({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "Fazit: 2 Findings.",
          report: long,
        })),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).not.toContain(long);
    expect(d.message.length).toBeLessThan(500);
  });
});

// req-016: the Doku task. Once per repo and calendar day it updates the
// multi-page user documentation under site/user-docs/ and pushes it on dev —
// but only when the repo points it at a design template that is really there.
describe("executeStep — Doku-Task (req-016)", () => {
  /** A doc-site.md whose Design-Vorlage section names no usable location. */
  const NO_DESIGN_MD = "# Doku-Site-Vorgaben\n\n## Deploy-Ziele\n\n- dev: beelink\n";

  it("AC: the docs are written under site/user-docs/ and pushed on dev", async () => {
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(repo, doku, [], deps({ commitAndPush }));
    expect(d.kind).toBe("success");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: Doku aktualisiert",
      "tok",
      ON(),
    );
    if (d.kind !== "success") return;
    expect(d.message).toContain("auf dev gepusht");
    expect(d.message).toContain(USER_DOCS_DIR);
  });

  it("AC: no design template -> nothing happens and the Verlauf says why", async () => {
    const runClaude = vi.fn(async () => ({ ok: true, summary: "x", report: "" }));
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        readRepoFile: vi.fn(async () => null), // no delivery/doc-site.md at all
        runClaude,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(NO_DESIGN_MESSAGE);
    expect(runClaude).not.toHaveBeenCalled(); // not even an hour of Claude
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("a doc-site.md that names no location is no design template either", async () => {
    const runClaude = vi.fn(async () => ({ ok: true, summary: "x", report: "" }));
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({ readRepoFile: vi.fn(async () => NO_DESIGN_MD), runClaude }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(NO_DESIGN_MESSAGE);
    expect(runClaude).not.toHaveBeenCalled();
  });

  it("a location that is not in the repo is no design template either", async () => {
    // doc-site.md points at delivery/doc-design/, but nobody uploaded it.
    const runClaude = vi.fn(async () => ({ ok: true, summary: "x", report: "" }));
    const repoPathExists = vi.fn(async (_dir: string, _rel: string) => false);
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({ repoPathExists, runClaude }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(NO_DESIGN_MESSAGE);
    expect(repoPathExists).toHaveBeenCalledWith(
      "/work/appbaua",
      "delivery/doc-design",
    );
    expect(runClaude).not.toHaveBeenCalled();
  });

  it("AC: a second run on the same calendar day is skipped", async () => {
    const ranToday: RunLogEntry[] = [
      {
        id: 1,
        startedAt: new Date(2026, 6, 24, 9, 0).toISOString(),
        endedAt: new Date(2026, 6, 24, 10, 0).toISOString(),
        repo: "appbaua",
        taskType: "Doku",
        status: "success",
        message: "Doku aktualisiert",
      },
    ];
    const prepareRepo = vi.fn(async () => PREPARED);
    const d = await executeStep(repo, doku, ranToday, deps({ prepareRepo }));
    expect(d.kind).toBe("skip");
    expect(prepareRepo).not.toHaveBeenCalled(); // skipped before cloning
  });

  it("a run without a template still uses up the day", async () => {
    // Otherwise every pass of the day would clone the repo again just to find
    // out that there is still no design template.
    const none = await executeStep(
      repo,
      doku,
      [],
      deps({ readRepoFile: vi.fn(async () => null) }),
    );
    expect(none.kind).toBe("success");
    if (none.kind !== "success") return;
    const log: RunLogEntry[] = [
      {
        id: 1,
        startedAt: now.toISOString(),
        endedAt: now.toISOString(),
        repo: "appbaua",
        taskType: "Doku",
        status: "success",
        message: none.message,
      },
    ];
    expect((await executeStep(repo, doku, log, deps())).kind).toBe("skip");
  });

  it("AC: the design template, the docs folder and the done requirements reach Claude", async () => {
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "Doku aktualisiert", report: "" };
    });
    await executeStep(repo, doku, [], deps({ runClaude }));
    expect(seenPrompt).toContain("delivery/doc-design/"); // from doc-site.md
    expect(seenPrompt).toContain("delivery/doc-site.md");
    expect(seenPrompt).toContain("site/user-docs/");
    expect(seenPrompt).toContain("delivery/requirements/done/");
  });

  it("AC: the update is incremental — unchanged pages stay as they are", async () => {
    // Nothing in the worker can rebuild-proof the pages; the prompt is the only
    // place that can rule a full rebuild out, so that is what is checked.
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "ergänzt", report: "" };
    });
    await executeStep(repo, doku, [], deps({ runClaude }));
    expect(seenPrompt).toContain("INKREMENTELL");
    expect(seenPrompt).toContain("NICHT bei jedem Lauf neu");
  });

  it("a run that changed nothing is a normal day, not a failure", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: NO_CHANGES_DETAIL,
        })),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(DOC_UNCHANGED_MESSAGE);
  });

  it("a push that fails is an error since req-020, not a quiet success", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: "push failed: keine Rechte",
        })),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("push failed: keine Rechte");
    expect(d.message).not.toBe(DOC_UNCHANGED_MESSAGE);
  });

  it("files no report — the pages are the result (delivery/reviews stays empty)", async () => {
    const writeRepoFile = writerFake();
    await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "Doku aktualisiert",
          report: "# Ein langer Bericht",
        })),
        writeRepoFile,
      }),
    );
    expect(writeRepoFile).not.toHaveBeenCalled();
  });

  it("claims no .md — the Doku task has no work-item queue", async () => {
    const listReady = folders();
    const moveMd = vi.fn(async () => {});
    const setCurrentMd = vi.fn(async (_md: string | null) => {});
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({ listReady, moveMd, setCurrentMd }),
    );
    expect(d.kind).toBe("success");
    expect(listReady).not.toHaveBeenCalled();
    expect(moveMd).not.toHaveBeenCalled();
    expect(setCurrentMd).not.toHaveBeenCalled();
  });

  it("a failed Claude run stays an error and pushes nothing", async () => {
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "x" }));
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Timeout");
    expect(commitAndPush).not.toHaveBeenCalled();
  });

  it("an unreadable doc-site.md is treated as 'no template', not as a crash", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        readRepoFile: vi.fn(async () => {
          throw new Error("Platte weg");
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(NO_DESIGN_MESSAGE);
  });

  it("the log keeps the short message, not Claude's whole answer", async () => {
    const long = `${"x".repeat(5000)}\nFazit: 3 Seiten ergänzt.`;
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "Fazit: 3 Seiten ergänzt.",
          report: long,
        })),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).not.toContain(long);
    expect(d.message.length).toBeLessThan(500);
  });
});

// req-017: the Doku task bebildert its pages. Before Claude starts, the worker
// photographs the app's running dev environment into site/user-docs/ and hands
// the list over in the prompt. A picture that could not be taken must cost its
// illustration and NOTHING else — the docs get built either way.
describe("executeStep — Doku-Screenshots (req-017)", () => {
  const START = {
    page: "/",
    file: "start.png",
    rel: `${SCREENSHOT_DIR}/start.png`,
  };
  const VERLAUF = {
    page: "/verlauf",
    file: "verlauf.png",
    rel: `${SCREENSHOT_DIR}/verlauf.png`,
  };

  /** A capture that came back with `shot` pictures and `missing` gaps. */
  function shots(result: ShotResult) {
    return vi.fn(async (_dir: string, _url: string | null) => result);
  }

  it("AC: the screenshots are taken against the repo's dev environment", async () => {
    const captureScreenshots = shots({ shot: [START], missing: [] });
    await executeStep(repo, doku, [], deps({ captureScreenshots }));
    expect(captureScreenshots).toHaveBeenCalledWith(
      "/work/appbaua",
      "https://dev.appbaua.com", // from delivery/devops.md, never the prod URL
    );
  });

  it("AC: the pictures reach Claude, so a doc page can show them", async () => {
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "Doku aktualisiert", report: "" };
    });
    await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude,
        captureScreenshots: shots({ shot: [START, VERLAUF], missing: [] }),
      }),
    );
    expect(seenPrompt).toContain(START.rel);
    expect(seenPrompt).toContain(VERLAUF.rel);
    expect(seenPrompt).toContain("Binde jeden davon dort ein");
  });

  it("AC: the pictures are there before Claude runs — it can only place existing files", async () => {
    const order: string[] = [];
    await executeStep(
      repo,
      doku,
      [],
      deps({
        captureScreenshots: vi.fn(async (_dir: string, _url: string | null) => {
          order.push("screenshots");
          return { shot: [START], missing: [] };
        }),
        runClaude: vi.fn(async () => {
          order.push("claude");
          return { ok: true, summary: "Doku aktualisiert", report: "" };
        }),
      }),
    );
    expect(order).toEqual(["screenshots", "claude"]);
  });

  it("AC: the pictures are pushed with the docs", async () => {
    // They lie inside site/user-docs/, so the same commit carries them.
    expect(START.rel.startsWith(`${USER_DOCS_DIR}/`)).toBe(true);
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({ commitAndPush, captureScreenshots: shots({ shot: [START], missing: [] }) }),
    );
    expect(d.kind).toBe("success");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: Doku aktualisiert",
      "tok",
      ON(),
    );
    if (d.kind !== "success") return;
    expect(d.message).toContain("Screenshots: 1");
  });

  it("AC: a failed screenshot is noted in the Verlauf and the doc is built anyway", async () => {
    const runClaude = vi.fn(async () => ({
      ok: true,
      summary: "Doku aktualisiert",
      report: "",
    }));
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude,
        commitAndPush,
        captureScreenshots: shots({
          shot: [START],
          missing: [{ page: "/verlauf", reason: "nicht erreichbar" }],
        }),
      }),
    );
    expect(d.kind).toBe("success");
    expect(runClaude).toHaveBeenCalled(); // the doc is built regardless
    expect(commitAndPush).toHaveBeenCalled();
    if (d.kind !== "success") return;
    expect(d.message).toContain("ohne Bild: /verlauf (nicht erreichbar)");
  });

  it("AC: the dev environment being down does not stop the Doku run", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        captureScreenshots: shots({
          shot: [],
          missing: [{ page: "/", reason: "nicht erreichbar" }],
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain("keine Screenshots");
    expect(d.message).toContain("ohne Bild: /");
  });

  it("AC: without pictures Claude is told to reference no image at all", async () => {
    // That is what keeps a failed screenshot from leaving a broken image behind.
    let seenPrompt = "";
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      seenPrompt = prompt;
      return { ok: true, summary: "Doku aktualisiert", report: "" };
    });
    await executeStep(
      repo,
      doku,
      [],
      deps({
        runClaude,
        captureScreenshots: shots({
          shot: [],
          missing: [{ page: "/", reason: "nicht erreichbar" }],
        }),
      }),
    );
    expect(seenPrompt).toContain("KEINE neuen Screenshots");
    expect(seenPrompt).toContain("KEINE Bild-Datei, die");
  });

  it("a run that changed nothing still reports its pictures", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: NO_CHANGES_DETAIL,
        })),
        captureScreenshots: shots({
          shot: [START],
          missing: [{ page: "/verlauf", reason: "nicht erreichbar" }],
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain(DOC_UNCHANGED_MESSAGE);
    expect(d.message).toContain("ohne Bild: /verlauf");
  });

  it("a repo without a dev environment gets no pictures, and the Verlauf says so", async () => {
    const captureScreenshots = shots({
      shot: [],
      missing: [{ page: "/", reason: NO_DEV_URL_MESSAGE }],
    });
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        // doc-site.md is there, devops.md is not
        readRepoFile: vi.fn(async (_dir: string, rel: string) =>
          rel === "delivery/doc-site.md" ? DOC_SITE_MD : null,
        ),
        captureScreenshots,
      }),
    );
    expect(captureScreenshots).toHaveBeenCalledWith("/work/appbaua", null);
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain(NO_DEV_URL_MESSAGE);
  });

  it("a crashing screenshot run never fails the Doku step", async () => {
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        captureScreenshots: vi.fn(async () => {
          throw new Error("Browser weg");
        }),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain("Screenshot-Lauf abgebrochen");
    expect(d.message).toContain("Browser weg");
  });

  it("no design template -> not even a browser is started", async () => {
    // The Doku task does NOTHING without one (req-016); shooting screenshots for
    // a doc that is never written would be an hour of browser for nothing.
    const captureScreenshots = shots({ shot: [START], missing: [] });
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({ readRepoFile: vi.fn(async () => null), captureScreenshots }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toBe(NO_DESIGN_MESSAGE);
    expect(captureScreenshots).not.toHaveBeenCalled();
  });

  it("no other task type photographs anything", async () => {
    const captureScreenshots = shots({ shot: [START], missing: [] });
    await executeStep(repo, review, [], deps({ captureScreenshots }));
    await executeStep(repo, security, [], deps({ captureScreenshots }));
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["bug-001.md"] }),
        captureScreenshots,
      }),
    );
    expect(captureScreenshots).not.toHaveBeenCalled();
  });
});

// req-019: nothing reaches done/ on a red suite. A file-driven .md is only
// filed as finished after the repo's FULL test suite has run and come back
// green — one repair attempt in the same run, and what stays red goes to
// failed/ with its cause in the Verlauf.
describe("executeStep — Test-Gate vor done/ (req-019)", () => {
  /** The one .md this repo has waiting. */
  const ready = () => folders({ ready: ["req-001.md"] });
  const DONE = "delivery/bugs/done/req-001.md";
  const FAILED = "delivery/bugs/failed/req-001.md";

  /** A gate that is red on the first ask and green on every one after it. */
  function redThenGreen() {
    let asked = 0;
    return vi.fn(async (_dir: string, _stack: string | null) => {
      asked += 1;
      return asked === 1 ? red("npm test: FAIL lib/foo.test.ts") : green();
    });
  }

  it("AC: green suite -> the .md lands in done/", async () => {
    const moveMd = vi.fn(async () => {});
    const runTestGate = vi.fn(async (_dir: string, _stack: string | null) => green());
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: ready(), moveMd, runTestGate }),
    );
    expect(d.kind).toBe("success");
    expect(runTestGate).toHaveBeenCalledTimes(1);
    expect(moveMd).toHaveBeenLastCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/req-001.md",
      DONE,
    );
  });

  it("AC: red, then repaired in the same run -> the .md still lands in done/", async () => {
    const moveMd = vi.fn(async () => {});
    const runTestGate = redThenGreen();
    const prompts: string[] = [];
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      prompts.push(prompt);
      return { ok: true, summary: "erledigt", report: "" };
    });
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: ready(), moveMd, runTestGate, runClaude }),
    );
    expect(d.kind).toBe("success");
    expect(runTestGate).toHaveBeenCalledTimes(2); // checked again after the repair
    expect(prompts).toHaveLength(2); // work run + repair run
    expect(prompts[1]).toContain("FAIL lib/foo.test.ts"); // the cause reaches Claude
    expect(moveMd).toHaveBeenLastCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/req-001.md",
      DONE,
    );
  });

  it("AC: still red after the repair -> failed/, NOT done/, and the Verlauf names the cause", async () => {
    const moveMd = vi.fn(async (_dir: string, _from: string, _to: string) => {});
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate: vi.fn(async () => red("npm test: FAIL lib/foo.test.ts > kaputt")),
        moveMd,
        commitAndPush,
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain(GATE_RED_MESSAGE);
    expect(d.message).toContain("FAIL lib/foo.test.ts > kaputt");
    expect(d.message).toContain("req-001.md nach failed/ verschoben");
    expect(d.md).toBe("req-001.md");
    // parked exactly like a failed Claude run (bug-002): out of ready/, so the
    // commit carries both halves of the move
    expect(moveMd).toHaveBeenLastCalledWith(
      "/work/appbaua",
      "delivery/bugs/ready/req-001.md",
      FAILED,
    );
    expect(moveMd.mock.calls.map((c) => c[2])).not.toContain(DONE);
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: req-001.md fehlgeschlagen",
      "tok",
      ON(),
    );
  });

  it("AC: the gate runs before anything is moved to done/ or committed", async () => {
    // A gate after the commit would report on a state that is already on dev.
    const order: string[] = [];
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate: vi.fn(async () => {
          order.push("gate");
          return green();
        }),
        moveMd: vi.fn(async (_dir: string, _from: string, to: string) => {
          if (to === DONE) order.push("done");
        }),
        commitAndPush: vi.fn(async () => {
          order.push("push");
          return { pushed: true, detail: "auf dev gepusht" };
        }),
      }),
    );
    expect(order).toEqual(["gate", "done", "push"]);
  });

  it("AC: no exception for a change the run considers pure text or docs", async () => {
    // Nothing in the step may look at WHAT was changed — the gate is
    // unconditional for every file-driven run.
    const runTestGate = vi.fn(async (_dir: string, _stack: string | null) => green());
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate,
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "nur ein Tippfehler in der README, keine Tests nötig",
          report: "",
        })),
      }),
    );
    expect(runTestGate).toHaveBeenCalledTimes(1);
  });

  it("AC: a missing runtime dependency has to reach the package.json, not just this container", async () => {
    // The repair prompt is the only place that can rule out "installed here, so
    // it is green here" — the gate itself only sees red.
    const prompts: string[] = [];
    const runClaude = vi.fn(async (_dir: string, prompt: string) => {
      prompts.push(prompt);
      return { ok: true, summary: "erledigt", report: "" };
    });
    await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate: redThenGreen(),
        runClaude,
      }),
    );
    expect(prompts[1]).toContain("package.json");
    expect(prompts[1]).toContain("frischer Checkout");
    expect(prompts[1]).toContain("Lockfile");
    expect(prompts[1]).toContain("KEINEN Test"); // no green by deleting tests
  });

  it("the test command is looked up in the repo's own delivery/stack.md", async () => {
    const STACK = "## Commands\n\n- Test: `npm test`";
    const readRepoFile = vi.fn(async (_dir: string, rel: string) =>
      rel === STACK_FILE ? STACK : null,
    );
    const runTestGate = vi.fn(async (_dir: string, _stack: string | null) => green());
    await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: ready(), readRepoFile, runTestGate }),
    );
    expect(runTestGate).toHaveBeenCalledWith("/work/appbaua", STACK);
  });

  it("a repair run that itself fails leaves the gate red", async () => {
    const runTestGate = vi.fn(async () => red("npm test: FAIL"));
    let call = 0;
    const runClaude = vi.fn(async () => {
      call += 1;
      return call === 1
        ? { ok: true, summary: "erledigt", report: "" }
        : { ok: false, summary: "Timeout", report: "" };
    });
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: ready(), runTestGate, runClaude }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Reparaturversuch fehlgeschlagen");
    expect(d.message).toContain("Timeout");
    expect(runTestGate).toHaveBeenCalledTimes(1); // no second check to be had
  });

  it("a gate that crashes is red, not green", async () => {
    // "Could not check" must never pass for "checked and fine".
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate: vi.fn(async () => {
          throw new Error("npm weg");
        }),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain("Test-Lauf abgebrochen");
    expect(d.message).toContain("npm weg");
  });

  it("a repo that declares no test command still finishes, and the Verlauf says so", async () => {
    const moveMd = vi.fn(async () => {});
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        moveMd,
        runTestGate: vi.fn(async () => ({
          status: "no-command" as const,
          command: null,
          reason: NO_TEST_COMMAND_MESSAGE,
        })),
      }),
    );
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain(NO_TEST_COMMAND_MESSAGE);
    expect(moveMd).toHaveBeenLastCalledWith(
      "/work/appbaua",
      "delivery/bugs/in-progress/req-001.md",
      DONE,
    );
  });

  it("a green gate is visible in the Verlauf", async () => {
    const d = await executeStep(repo, bug, [], deps({ listReady: ready() }));
    expect(d.kind).toBe("success");
    if (d.kind !== "success") return;
    expect(d.message).toContain(GATE_GREEN_MESSAGE);
    expect(d.message).toContain("npm test");
  });

  it("a failed Claude run is parked without ever asking the gate", async () => {
    const runTestGate = vi.fn(async (_dir: string, _stack: string | null) => green());
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: ready(),
        runTestGate,
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
      }),
    );
    expect(d.kind).toBe("error");
    expect(runTestGate).not.toHaveBeenCalled();
  });

  it("the recurring types keep their behaviour — no gate, no done/ (out of scope)", async () => {
    const runTestGate = vi.fn(async (_dir: string, _stack: string | null) => green());
    for (const type of [review, ideen, security, doku]) {
      await executeStep(repo, type, [], deps({ runTestGate }));
    }
    expect(runTestGate).not.toHaveBeenCalled();
  });
});

// req-020: der Worker committet auf dem Branch, den das ZIELREPO nennt — und
// was beim Vorbereiten oder beim Pushen scheitert, steht als Fehler im Verlauf
// statt nur auf der Konsole. Beides zusammen ist der Grund, warum ein Repo mit
// abweichender Branch-Konvention bisher unbearbeitet blieb und der Worker ohne
// erkennbaren Grund pausierte.
describe("executeStep — Branch des Zielrepos und sichtbare Fehler (req-020)", () => {
  /** A repo prepared on `branch` instead of the standard dev. */
  const preparedOn = (branch: string) =>
    vi.fn(async () => ({ dir: "/work/appbaua", branch }));

  /** A push that did not happen although there was something to push. */
  const refused = () =>
    vi.fn(async () => ({ pushed: false, detail: "push failed: keine Rechte" }));

  /** An idea folder that gained one file during the run (req-011 mechanics). */
  function proposedIdea(): ExecuteDeps["listReady"] {
    let asked = 0;
    return vi.fn(async (_dir: string, rel: string) => {
      if (rel !== "delivery/idea") return [];
      asked += 1;
      return asked === 1 ? [] : ["dark-mode.md"];
    });
  }

  it("AC: ein Standard-Repo wird unverändert auf dev committet", async () => {
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf dev gepusht",
    }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({ listReady: folders({ ready: ["req-001.md"] }), commitAndPush }),
    );
    expect(d.kind).toBe("success");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: req-001.md abgearbeitet",
      "tok",
      ON("dev"),
    );
  });

  it("AC: ein Repo ohne dev-Branch wird auf seinem eigenen Branch committet", async () => {
    const commitAndPush = vi.fn(async () => ({
      pushed: true,
      detail: "auf feature/garten gepusht",
    }));
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        prepareRepo: preparedOn("feature/garten"),
        listReady: folders({ ready: ["req-001.md"] }),
        commitAndPush,
      }),
    );
    // AC: die Arbeit wird tatsächlich bearbeitet, nicht übersprungen
    expect(d.kind).toBe("success");
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: req-001.md abgearbeitet",
      "tok",
      ON("feature/garten"),
    );
    // …und nichts davon geht auf dev
    expect(commitAndPush).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      ON("dev"),
    );
  });

  it("auch eine fehlgeschlagene .md wird auf dem Branch des Repos geparkt", async () => {
    const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "gepusht" }));
    await executeStep(
      repo,
      bug,
      [],
      deps({
        prepareRepo: preparedOn("feature/garten"),
        listReady: folders({ ready: ["req-001.md"] }),
        runClaude: vi.fn(async () => ({ ok: false, summary: "Timeout", report: "" })),
        commitAndPush,
      }),
    );
    expect(commitAndPush).toHaveBeenCalledWith(
      "/work/appbaua",
      "worker: req-001.md fehlgeschlagen",
      "tok",
      ON("feature/garten"),
    );
  });

  it("jede Aufgabenart committet auf dem Branch des Repos, nicht auf dev", async () => {
    const cases: { type: typeof bug; listReady: ExecuteDeps["listReady"] }[] = [
      { type: ideen, listReady: proposedIdea() },
      { type: security, listReady: folders() },
      { type: doku, listReady: folders() },
      { type: review, listReady: folders() },
    ];
    for (const { type, listReady } of cases) {
      const commitAndPush = vi.fn(async () => ({ pushed: true, detail: "gepusht" }));
      await executeStep(
        repo,
        type,
        [],
        deps({
          prepareRepo: preparedOn("feature/garten"),
          listReady,
          runClaude: vi.fn(async () => ({
            ok: true,
            summary: "fertig",
            report: "# Befund",
          })),
          commitAndPush,
        }),
      );
      expect(commitAndPush).toHaveBeenCalledWith(
        "/work/appbaua",
        expect.any(String),
        "tok",
        ON("feature/garten"),
      );
    }
  });

  it("AC: scheitert das Vorbereiten, nennt der Verlauf Repo und Grund", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        prepareRepo: vi.fn(async () => {
          throw new Error("fatal: Remote branch dev not found in upstream origin");
        }),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain(PREPARE_FAILED_MESSAGE);
    expect(d.message).toContain(repo.name);
    expect(d.message).toContain("Remote branch dev not found");
  });

  it("AC: scheitert der Push, nennt der Verlauf Repo und Grund", async () => {
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["req-001.md"] }),
        commitAndPush: refused(),
      }),
    );
    expect(d.kind).toBe("error");
    if (d.kind !== "error") return;
    expect(d.message).toContain(PUSH_FAILED_MESSAGE);
    expect(d.message).toContain(repo.name);
    expect(d.message).toContain("keine Rechte");
    expect(d.md).toBe("req-001.md"); // der Verlauf weiß, woran es lag
  });

  it("ein gescheiterter Push parkt die .md NICHT unter failed/", async () => {
    // Die Arbeit war in Ordnung, und committet wurde nichts — der nächste Lauf
    // findet die .md wieder in ready/ und versucht es erneut.
    const moveMd = vi.fn(async (_dir: string, _from: string, _to: string) => {});
    const d = await executeStep(
      repo,
      bug,
      [],
      deps({
        listReady: folders({ ready: ["req-001.md"] }),
        commitAndPush: refused(),
        moveMd,
      }),
    );
    expect(d.kind).toBe("error");
    expect(moveMd.mock.calls.map((c) => c[2])).not.toContain(
      "delivery/bugs/failed/req-001.md",
    );
  });

  it("ein Push, der nichts zu committen fand, bleibt ein Erfolg", async () => {
    // Ein Lauf darf nichts ändern; das ist kein Fehler, sondern ein ruhiger Tag.
    const d = await executeStep(
      repo,
      doku,
      [],
      deps({
        commitAndPush: vi.fn(async () => ({
          pushed: false,
          detail: NO_CHANGES_DETAIL,
        })),
      }),
    );
    expect(d.kind).toBe("success");
  });

  it("ein gescheiterter Push der Ideen- und Security-Aufgabe ist ebenfalls ein Fehler", async () => {
    const idea = await executeStep(
      repo,
      ideen,
      [],
      deps({
        listReady: proposedIdea(),
        commitAndPush: refused(),
      }),
    );
    expect(idea.kind).toBe("error");

    const sec = await executeStep(
      repo,
      security,
      [],
      deps({
        runClaude: vi.fn(async () => ({
          ok: true,
          summary: "1 Finding",
          report: "## Zusammenfassung\n\nEin Befund.",
        })),
        commitAndPush: refused(),
      }),
    );
    expect(sec.kind).toBe("error");
    if (sec.kind !== "error") return;
    expect(sec.message).toContain("delivery/security/"); // Bericht bleibt auffindbar
  });
});
