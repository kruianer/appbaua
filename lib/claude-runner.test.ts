import { describe, it, expect } from "vitest";
import {
  createActivityStream,
  createLiveTail,
  lastLines,
  runClaude,
  LIVE_TAIL_LINES,
} from "./claude-runner";
import type { run } from "./workspace";

// Live output of a running Claude step (req-008): only the last ~50 lines, and
// at most about once per second.

describe("lastLines", () => {
  it("returns everything when there are fewer lines than asked for", () => {
    expect(lastLines("a\nb", 5)).toBe("a\nb");
  });

  it("keeps only the last n lines", () => {
    expect(lastLines("1\n2\n3\n4\n5", 2)).toBe("4\n5");
  });

  it("defaults to the configured tail length", () => {
    const many = Array.from({ length: 200 }, (_, i) => `l${i}`).join("\n");
    expect(lastLines(many).split("\n")).toHaveLength(LIVE_TAIL_LINES);
  });
});

describe("createLiveTail", () => {
  it("emits the first chunk immediately", () => {
    const seen: string[] = [];
    const push = createLiveTail((t) => seen.push(t), { now: () => 0 });
    push("hallo");
    expect(seen).toEqual(["hallo"]);
  });

  it("throttles to one emit per interval and always sends the current tail", () => {
    const seen: string[] = [];
    let t = 0;
    const push = createLiveTail((x) => seen.push(x), {
      intervalMs: 1000,
      now: () => t,
    });
    push("a");
    push("b"); // same instant -> throttled away
    t = 999;
    push("c"); // still inside the window
    t = 1000;
    push("d"); // window elapsed -> current full tail
    expect(seen).toEqual(["a", "abcd"]);
  });

  it("keeps only the last n lines of everything seen so far", () => {
    const seen: string[] = [];
    let t = 0;
    const push = createLiveTail((x) => seen.push(x), {
      intervalMs: 1000,
      lines: 3,
      now: () => t,
    });
    push("1\n2\n3\n");
    t = 1000;
    push("4\n5\n");
    expect(seen[seen.length - 1]).toBe("4\n5\n");
  });
});

describe("runClaude live output", () => {
  /** Fake process that pushes two chunks a second apart, then succeeds. */
  const streamingRun =
    (clock: { t: number }): typeof run =>
    async (_cmd, _args, opts = {}) => {
      opts.onData?.("Zeile 1\n");
      clock.t += 1000;
      opts.onData?.("Zeile 2\n");
      return { ok: true, code: 0, stdout: "Zeile 1\nZeile 2\n", stderr: "" };
    };

  it("forwards the throttled tail to onOutput", async () => {
    const clock = { t: 0 };
    const seen: string[] = [];
    const out = await runClaude("/repo", "prompt", {
      runImpl: streamingRun(clock),
      onOutput: (tail) => seen.push(tail),
      now: () => clock.t,
    });
    expect(out.ok).toBe(true);
    expect(seen).toEqual(["Zeile 1\n", "Zeile 1\nZeile 2\n"]);
  });

  it("passes no stream listener when nobody wants the live output", async () => {
    let sawListener = true;
    const runImpl: typeof run = async (_cmd, _args, opts = {}) => {
      sawListener = opts.onData !== undefined;
      return { ok: true, code: 0, stdout: "ok", stderr: "" };
    };
    await runClaude("/repo", "prompt", { runImpl });
    expect(sawListener).toBe(false);
  });
});

// bug-001: the Aktivität tab used to show nothing but the CLI's stdin warning
// for minutes, because print mode writes to stdout only at the very end. The
// run now asks for the structured event stream and closes stdin.

describe("createActivityStream (bug-001)", () => {
  it("holds back an incomplete line until the rest arrives", () => {
    const event = JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
    });
    const seen: string[] = [];
    const push = createActivityStream((t) => seen.push(t), { now: () => 0 });
    push(event.slice(0, 20));
    expect(seen).toEqual([]); // nothing parseable yet
    push(`${event.slice(20)}\n`);
    expect(seen).toEqual(["→ Bash: npm test\n"]);
  });

  it("emits nothing for events that say nothing worth showing", () => {
    const seen: string[] = [];
    const push = createActivityStream((t) => seen.push(t), { now: () => 0 });
    push(`${JSON.stringify({ type: "stream_event" })}\n`);
    expect(seen).toEqual([]);
  });
});

describe("runClaude — real progress instead of the stdin warning (bug-001)", () => {
  const EVENTS = [
    JSON.stringify({ type: "system", subtype: "init", model: "opus" }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Read", input: { file_path: "lib/foo.ts" } }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "text", text: "Ich passe den Test an." }] },
    }),
    JSON.stringify({
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: { command: "npm test" } }] },
    }),
    JSON.stringify({ type: "result", subtype: "success", result: "Fazit: Tests gruen." }),
  ];
  const STDOUT = `${EVENTS.join("\n")}\n`;

  /**
   * Fake CLI that behaves like the real one did in the bug: it warns about
   * stdin first, then streams its events a second apart.
   */
  const streamingRun =
    (clock: { t: number }): typeof run =>
    async (_cmd, _args, opts = {}) => {
      opts.onData?.(
        "Warning: no stdin data received in 3s, proceeding without it." +
          " If piping from a slow command, redirect stdin explicitly:" +
          " < /dev/null to skip, or wait longer.\n",
      );
      for (const event of EVENTS) {
        clock.t += 1000;
        opts.onData?.(`${event}\n`);
      }
      return { ok: true, code: 0, stdout: STDOUT, stderr: "" };
    };

  it("AC: the live output names the current activity", async () => {
    const clock = { t: 0 };
    const seen: string[] = [];
    const out = await runClaude("/repo", "prompt", {
      runImpl: streamingRun(clock),
      onOutput: (tail) => seen.push(tail),
      now: () => clock.t,
    });
    expect(out.ok).toBe(true);
    const last = seen[seen.length - 1];
    expect(last).toContain("→ Read: lib/foo.ts");
    expect(last).toContain("Ich passe den Test an.");
    expect(last).toContain("→ Bash: npm test");
  });

  it("AC: the live output changes while the step runs", async () => {
    const clock = { t: 0 };
    const seen: string[] = [];
    await runClaude("/repo", "prompt", {
      runImpl: streamingRun(clock),
      onOutput: (tail) => seen.push(tail),
      now: () => clock.t,
    });
    expect(seen.length).toBeGreaterThan(1);
    expect(new Set(seen).size).toBe(seen.length); // every write differs
  });

  it("AC: the stdin warning never reaches the live output", async () => {
    const clock = { t: 0 };
    const seen: string[] = [];
    await runClaude("/repo", "prompt", {
      runImpl: streamingRun(clock),
      onOutput: (tail) => seen.push(tail),
      now: () => clock.t,
    });
    expect(seen.join("\n")).not.toContain("no stdin data received");
  });

  it("asks the CLI for the streaming event format and closes stdin", async () => {
    let seenArgs: string[] = [];
    let seenStdin: string | undefined;
    const runImpl: typeof run = async (_cmd, args, opts = {}) => {
      seenArgs = args;
      seenStdin = opts.stdin;
      return { ok: true, code: 0, stdout: STDOUT, stderr: "" };
    };
    await runClaude("/repo", "prompt", { runImpl });
    expect(seenArgs[seenArgs.indexOf("--output-format") + 1]).toBe("stream-json");
    expect(seenArgs).toContain("--verbose");
    expect(seenStdin).toBe("ignore");
  });

  it("AC: the logged summary is still Claude's final answer, not the event stream", async () => {
    const runImpl: typeof run = async () => ({
      ok: true,
      code: 0,
      stdout: STDOUT,
      stderr: "",
    });
    const out = await runClaude("/repo", "prompt", { runImpl });
    expect(out.summary).toBe("Fazit: Tests gruen.");
  });

  it("a failed run still reports the error, not raw JSON", async () => {
    const runImpl: typeof run = async () => ({
      ok: false,
      code: 1,
      stdout: STDOUT,
      stderr: "claude: boom\n",
    });
    const out = await runClaude("/repo", "prompt", { runImpl });
    expect(out.summary).toBe("Claude-Lauf fehlgeschlagen: claude: boom");
  });

  it("a failed run without stderr falls back to the streamed result", async () => {
    const stdout = `${JSON.stringify({
      type: "result",
      subtype: "error_during_execution",
      result: "abgebrochen",
    })}\n`;
    const runImpl: typeof run = async () => ({
      ok: false,
      code: 1,
      stdout,
      stderr: "",
    });
    const out = await runClaude("/repo", "prompt", { runImpl });
    expect(out.summary).toBe("Claude-Lauf fehlgeschlagen: abgebrochen");
  });
});
