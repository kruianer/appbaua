import { describe, it, expect } from "vitest";
import {
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
