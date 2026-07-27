import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { RunResult, RunOptions } from "./workspace";
import {
  DEPENDENCY_DIR,
  GATE_GREEN_MESSAGE,
  NO_TEST_COMMAND_MESSAGE,
  failureTail,
  installCommandFrom,
  runTestGate,
  splitCommand,
  testCommandFrom,
  testGateNote,
} from "./test-gate";

// req-019: the gate that decides whether a file-driven requirement may be
// called finished. Its whole value is that it reports a FACT — so "could not
// check" has to come out red, and a repo without a declared test command has to
// say so out loud instead of quietly passing as green.

/** A stack.md in the shape the setup-stack skill writes it. */
const STACK = [
  "# Tech Stack",
  "",
  "## Languages & Frameworks",
  "",
  "- Sprache: TypeScript auf Node.",
  "- Test: hier steht nur Prosa, das ist kein Befehl",
  "",
  "## Commands",
  "",
  "- Install: `npm install`",
  "- Build:   `npm run build`",
  "- Test:    `npm test` (Vitest, headless `vitest run`)",
  "- E2E:     `npx playwright test` (noch nicht eingerichtet — folgt mit dem",
  "  ersten UI-Flow, der E2E braucht).",
  "- Lint:    `npm run lint`",
  "",
  "## Testing",
  "",
  "- Test: `npm run das-hier-nicht`",
].join("\n");

const ok = (stdout = ""): RunResult => ({ ok: true, code: 0, stdout, stderr: "" });
const fail = (stdout = "", stderr = "", code = 1): RunResult => ({
  ok: false,
  code,
  stdout,
  stderr,
});

/** A runner that answers per program+args, and records what it was asked to do. */
function runner(answer: (cmd: string, args: string[]) => RunResult) {
  return vi.fn(async (cmd: string, args: string[], _opts?: RunOptions) =>
    answer(cmd, args),
  );
}

describe("testCommandFrom / installCommandFrom (req-019)", () => {
  it("AC: the full-suite command comes out of delivery/stack.md", () => {
    expect(testCommandFrom(STACK)).toBe("npm test");
    expect(installCommandFrom(STACK)).toBe("npm install");
  });

  it("reads only the Commands section — a later 'Test:' row is not the command", () => {
    // The Testing section talks ABOUT tests; only Commands lists what to run.
    expect(testCommandFrom(STACK)).not.toBe("npm run das-hier-nicht");
  });

  it("the E2E row next to it is not the full suite", () => {
    expect(testCommandFrom(STACK)).not.toContain("playwright");
  });

  it("a row without a backticked command names no command", () => {
    const stack = [
      "## Commands",
      "",
      "- Test: noch nicht eingerichtet, kommt bei Bedarf",
    ].join("\n");
    expect(testCommandFrom(stack)).toBeNull();
  });

  it("no Commands section, no file at all -> no command", () => {
    expect(testCommandFrom("# Tech Stack\n\n## Testing\n\n- Test: `npm test`")).toBeNull();
    expect(testCommandFrom(null)).toBeNull();
    expect(testCommandFrom(undefined)).toBeNull();
  });
});

describe("splitCommand (req-019)", () => {
  it("splits a plain command into program and arguments", () => {
    expect(splitCommand("npm run test")).toEqual({ cmd: "npm", args: ["run", "test"] });
  });

  it("refuses shell syntax — the worker spawns without a shell", () => {
    expect(splitCommand("npm ci && npm test")).toBeNull();
    expect(splitCommand("npm test | tee log")).toBeNull();
  });

  it("an empty command is no command", () => {
    expect(splitCommand("   ")).toBeNull();
  });
});

describe("failureTail (req-019)", () => {
  it("keeps the tail, where a test runner prints what failed", () => {
    const long = `${"x".repeat(2000)}\nFAIL lib/foo.test.ts > tut nicht`;
    expect(failureTail(fail(long))).toContain("FAIL lib/foo.test.ts > tut nicht");
    expect(failureTail(fail(long)).length).toBeLessThanOrEqual(400);
  });

  it("says timeout when the run was killed for taking too long", () => {
    expect(failureTail(fail("", "", 124))).toBe("Timeout");
  });

  it("falls back to the exit code when nothing was printed", () => {
    expect(failureTail(fail("", "", 3))).toBe("Exit-Code 3");
  });
});

describe("runTestGate (req-019)", () => {
  it("AC: a green suite is green", async () => {
    const runImpl = runner(() => ok("2 passed"));
    const gate = await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    expect(gate.status).toBe("green");
    expect(gate.command).toBe("npm test");
    expect(gate.reason).toBe("");
  });

  it("AC: a red suite is red, and says why", async () => {
    const runImpl = runner((cmd, args) =>
      args[0] === "test" ? fail("FAIL lib/foo.test.ts > kaputt") : ok(),
    );
    const gate = await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    expect(gate.status).toBe("red");
    expect(gate.reason).toContain("npm test");
    expect(gate.reason).toContain("FAIL lib/foo.test.ts > kaputt");
  });

  it("bug-010: the install step forces a dev install so devDependencies (vitest) land", async () => {
    // The container runs NODE_ENV=production; a production install would skip
    // vitest.
    const runImpl = runner(() => ok());
    await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    const installCall = runImpl.mock.calls.find(
      (c) => c[0] === "npm" && c[1][0] === "install",
    );
    expect(installCall?.[2]?.env?.NODE_ENV).toBe("development");
    expect(installCall?.[2]?.env?.NPM_CONFIG_PRODUCTION).toBe("false");
  });

  it("bug-015: the suite itself also runs as development, not production", async () => {
    // Under NODE_ENV=production, libraries load their production builds and
    // drop the hooks test tools need: React's has no `act()`, so every React
    // Testing Library render throws and the gate calls a green suite red.
    // Originally only the install overrode the env — the test run inherited
    // the container's production setting, which is what this pins down.
    const runImpl = runner(() => ok());
    await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    const testCall = runImpl.mock.calls.find(
      (c) => c[0] === "npm" && c[1][0] === "test",
    );
    expect(testCall?.[2]?.env?.NODE_ENV).toBe("development");
  });

  it("AC: it counts the state of a fresh checkout — install runs into an empty folder", async () => {
    // A package that only ever got installed into this working copy survives
    // `git clean -fd`; emptying the folder first is what makes an undeclared
    // runtime dependency show up as red instead of staying invisible.
    const order: string[] = [];
    const removeDir = vi.fn(async (_p: string) => {
      order.push("leeren");
    });
    const runImpl = vi.fn(async (cmd: string, args: string[]) => {
      order.push([cmd, ...args].join(" "));
      return ok();
    });
    await runTestGate("/work/repo", STACK, { runImpl, removeDir });
    expect(order).toEqual(["leeren", "npm install", "npm test"]);
    expect(removeDir).toHaveBeenCalledWith(path.join("/work/repo", DEPENDENCY_DIR));
  });

  it("a failing install is a red gate, and the suite is not even started", async () => {
    const runImpl = runner((cmd, args) =>
      args[0] === "install" ? fail("", "E404 kein solches Paket") : ok(),
    );
    const gate = await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    expect(gate.status).toBe("red");
    expect(gate.reason).toContain("E404 kein solches Paket");
    expect(runImpl).toHaveBeenCalledTimes(1);
  });

  it("AC: a repo without a declared test command runs nothing and says so", async () => {
    const runImpl = runner(() => ok());
    const removeDir = vi.fn(async () => {});
    const gate = await runTestGate("/work/repo", "# Tech Stack", { runImpl, removeDir });
    expect(gate.status).toBe("no-command");
    expect(gate.reason).toBe(NO_TEST_COMMAND_MESSAGE);
    expect(runImpl).not.toHaveBeenCalled();
    expect(removeDir).not.toHaveBeenCalled(); // nothing to reinstall it from
  });

  it("without an install command the dependency folder stays untouched", async () => {
    const stack = ["## Commands", "", "- Test: `npm test`"].join("\n");
    const removeDir = vi.fn(async () => {});
    const runImpl = runner(() => ok());
    const gate = await runTestGate("/work/repo", stack, { runImpl, removeDir });
    expect(gate.status).toBe("green");
    expect(removeDir).not.toHaveBeenCalled();
    expect(runImpl).toHaveBeenCalledTimes(1);
  });

  it("req-025: a command the worker cannot spawn is not-runnable, not red", async () => {
    const stack = ["## Commands", "", "- Test: `npm test && npm run lint`"].join("\n");
    const runImpl = runner(() => ok());
    const gate = await runTestGate("/work/repo", stack, { runImpl });
    // Shell syntax the worker won't spawn: unchecked, not a red failure.
    expect(gate.status).toBe("not-runnable");
    expect(gate.reason).toContain("kein ausführbarer Befehl");
    expect(runImpl).not.toHaveBeenCalled();
  });

  it("req-025: a test tool that is not installed (exit 127) is not-runnable, not red", async () => {
    const stack = ["## Commands", "", "- Test: `colcon test`"].join("\n");
    // 127 = command not found. The suite could not run — that must not block.
    const runImpl = runner(() => fail("", "colcon: command not found", 127));
    const gate = await runTestGate("/work/repo", stack, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    expect(gate.status).toBe("not-runnable");
  });

  it("req-025: a suite that RAN and failed is still red (not-runnable only for unrunnable)", async () => {
    const stack = ["## Commands", "", "- Test: `npm test`"].join("\n");
    const runImpl = runner(() => fail("FAIL x.test.ts > kaputt", "", 1));
    const gate = await runTestGate("/work/repo", stack, {
      runImpl,
      removeDir: vi.fn(async () => {}),
    });
    expect(gate.status).toBe("red");
  });

  it("a dependency folder that cannot be removed does not stop the gate", async () => {
    const runImpl = runner(() => ok());
    const gate = await runTestGate("/work/repo", STACK, {
      runImpl,
      removeDir: vi.fn(async () => {
        throw new Error("busy");
      }),
    });
    expect(gate.status).toBe("green");
  });

  it("runs the commands in the repo working copy", async () => {
    const runImpl = vi.fn(async (_cmd: string, _args: string[], opts?: { cwd?: string }) => {
      expect(opts?.cwd).toBe("/work/repo");
      return ok();
    });
    await runTestGate("/work/repo", STACK, { runImpl, removeDir: vi.fn(async () => {}) });
    expect(runImpl).toHaveBeenCalledTimes(2);
  });
});

describe("testGateNote (req-019)", () => {
  it("names the command a green gate ran", () => {
    expect(testGateNote({ status: "green", command: "npm test", reason: "" })).toContain(
      GATE_GREEN_MESSAGE,
    );
    expect(testGateNote({ status: "green", command: "npm test", reason: "" })).toContain(
      "npm test",
    );
  });

  it("a run that had no suite to check says exactly that", () => {
    expect(
      testGateNote({ status: "no-command", command: null, reason: NO_TEST_COMMAND_MESSAGE }),
    ).toContain(NO_TEST_COMMAND_MESSAGE);
  });
});
