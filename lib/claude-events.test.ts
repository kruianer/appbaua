import { describe, it, expect } from "vitest";
import {
  MAX_ACTIVITY_LINE,
  describeEvent,
  finalResultText,
  toActivityLine,
} from "./claude-events";

// bug-001: the live output must show what Claude is actually doing. These tests
// pin the translation of the stream-json events into activity lines.

const line = (event: unknown) => JSON.stringify(event);
const assistant = (content: unknown[]) =>
  line({ type: "assistant", message: { role: "assistant", content } });

describe("describeEvent — tool activity", () => {
  it("names the tool and the file it touches", () => {
    expect(
      describeEvent(
        assistant([
          { type: "tool_use", name: "Read", input: { file_path: "lib/foo.ts" } },
        ]),
      ),
    ).toEqual(["→ Read: lib/foo.ts"]);
  });

  it("shows the command for Bash", () => {
    expect(
      describeEvent(
        assistant([
          { type: "tool_use", name: "Bash", input: { command: "npm test" } },
        ]),
      ),
    ).toEqual(["→ Bash: npm test"]);
  });

  it("shows the pattern for a search", () => {
    expect(
      describeEvent(
        assistant([
          {
            type: "tool_use",
            name: "Grep",
            input: { pattern: "createLiveTail", path: "lib" },
          },
        ]),
      ),
    ).toEqual(["→ Grep: createLiveTail"]);
  });

  it("falls back to the bare tool name when nothing tells what it works on", () => {
    expect(
      describeEvent(
        assistant([{ type: "tool_use", name: "TodoWrite", input: { todos: [] } }]),
      ),
    ).toEqual(["→ TodoWrite"]);
  });

  it("reports every block of one message, in order", () => {
    expect(
      describeEvent(
        assistant([
          { type: "text", text: "Ich sehe mir den Test an." },
          { type: "tool_use", name: "Read", input: { file_path: "a.ts" } },
          { type: "tool_use", name: "Edit", input: { file_path: "b.ts" } },
        ]),
      ),
    ).toEqual(["Ich sehe mir den Test an.", "→ Read: a.ts", "→ Edit: b.ts"]);
  });

  it("collapses a multi-line command into a single line", () => {
    expect(
      describeEvent(
        assistant([
          {
            type: "tool_use",
            name: "Bash",
            input: { command: "npm run lint\nnpm test" },
          },
        ]),
      ),
    ).toEqual(["→ Bash: npm run lint npm test"]);
  });

  it("skips empty text blocks", () => {
    expect(describeEvent(assistant([{ type: "text", text: "  \n " }]))).toEqual([]);
  });
});

describe("describeEvent — session and results", () => {
  it("announces the start with the model", () => {
    expect(
      describeEvent(line({ type: "system", subtype: "init", model: "opus" })),
    ).toEqual(["Claude Code gestartet (opus)"]);
  });

  it("ignores other system events", () => {
    expect(describeEvent(line({ type: "system", subtype: "hook" }))).toEqual([]);
  });

  it("reports the final answer", () => {
    expect(
      describeEvent(
        line({ type: "result", subtype: "success", result: "Tests sind gruen." }),
      ),
    ).toEqual(["Claude fertig: Tests sind gruen."]);
  });

  it("reports a result without text by its subtype", () => {
    expect(
      describeEvent(line({ type: "result", subtype: "error_max_turns" })),
    ).toEqual(["Claude fertig: error_max_turns"]);
  });

  it("shows a failed tool result", () => {
    expect(
      describeEvent(
        line({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", is_error: true, content: "File not found" },
            ],
          },
        }),
      ),
    ).toEqual(["⚠ Tool-Fehler: File not found"]);
  });

  it("stays silent about successful tool results, which are just payload", () => {
    expect(
      describeEvent(
        line({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", is_error: false, content: "1 lib/foo.ts" },
            ],
          },
        }),
      ),
    ).toEqual([]);
  });

  it("ignores unknown event types", () => {
    expect(describeEvent(line({ type: "stream_event", event: {} }))).toEqual([]);
  });

  it("ignores blank lines", () => {
    expect(describeEvent("   ")).toEqual([]);
  });
});

describe("describeEvent — non-JSON output", () => {
  it("AC: drops the stdin warning that used to be the whole live output", () => {
    expect(
      describeEvent(
        "Warning: no stdin data received in 3s, proceeding without it. If piping" +
          " from a slow command, redirect stdin explicitly: < /dev/null to skip," +
          " or wait longer.",
      ),
    ).toEqual([]);
  });

  it("passes other plain output through, so real errors stay visible", () => {
    expect(describeEvent("error: unknown option '--nope'")).toEqual([
      "error: unknown option '--nope'",
    ]);
  });
});

describe("toActivityLine", () => {
  it("leaves a short line alone", () => {
    expect(toActivityLine("kurz")).toBe("kurz");
  });

  it("truncates to the configured length with an ellipsis", () => {
    const out = toActivityLine("a".repeat(500));
    expect(out).toHaveLength(MAX_ACTIVITY_LINE);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("finalResultText", () => {
  it("returns the result of the last result event", () => {
    const stdout = [
      line({ type: "system", subtype: "init" }),
      line({ type: "result", subtype: "success", result: "Fazit des Laufs" }),
      "",
    ].join("\n");
    expect(finalResultText(stdout)).toBe("Fazit des Laufs");
  });

  it("falls back to the raw output when there is no result event", () => {
    expect(finalResultText("  irgendwas ging schief\n")).toBe(
      "irgendwas ging schief",
    );
  });

  it("survives broken lines in the stream", () => {
    const stdout = ['{"type":"assist', line({ type: "result", result: "ok" })].join(
      "\n",
    );
    expect(finalResultText(stdout)).toBe("ok");
  });
});
