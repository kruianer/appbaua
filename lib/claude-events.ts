// Reads the structured event stream of a Claude Code run (`--output-format
// stream-json`) and condenses it into human-readable activity lines (bug-001).
//
// Why: in plain print mode (`claude -p`) stdout stays silent until the very
// end, so the live output of req-008 looked frozen for minutes while Claude was
// in fact working — it showed nothing but the CLI's stdin warning. In
// stream-json mode the CLI emits one JSON object per line for every step of the
// session; `describeEvent` turns each of those into at most a few short lines
// ("→ Read: lib/foo.ts"), which is what the Aktivität tab shows.

/** Longest activity line published live; keeps the output field readable. */
export const MAX_ACTIVITY_LINE = 160;

/**
 * The warning the CLI prints when nothing is piped into it. The worker now runs
 * Claude with stdin closed so it no longer appears at all, but a line that
 * slips through anyway must never crowd out the real progress (bug-001).
 */
const STDIN_WARNING = /no stdin data received/i;

/**
 * Input fields that say WHAT a tool is working on, most telling first. This
 * list stays deliberately short: an unknown tool simply shows its name.
 */
const TOOL_TARGET_KEYS = [
  "file_path",
  "notebook_path",
  "command",
  "pattern",
  "url",
  "path",
  "description",
];

type ContentBlock = {
  type?: unknown;
  text?: unknown;
  name?: unknown;
  input?: unknown;
  is_error?: unknown;
  content?: unknown;
};

/** Collapse whitespace and cut over-long text, so one event stays one line. */
export function toActivityLine(
  text: string,
  max: number = MAX_ACTIVITY_LINE,
): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

function contentBlocks(message: unknown): ContentBlock[] {
  const content = (message as { content?: unknown } | null | undefined)?.content;
  return Array.isArray(content) ? (content as ContentBlock[]) : [];
}

function toolTarget(input: unknown): string {
  if (!input || typeof input !== "object") return "";
  const rec = input as Record<string, unknown>;
  for (const key of TOOL_TARGET_KEYS) {
    const value = rec[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

/** What Claude said and which tools it reached for, in the order it did. */
function describeAssistant(message: unknown): string[] {
  const lines: string[] = [];
  for (const block of contentBlocks(message)) {
    if (block.type === "text" && typeof block.text === "string") {
      const line = toActivityLine(block.text);
      if (line) lines.push(line);
    } else if (block.type === "tool_use" && typeof block.name === "string") {
      const target = toolTarget(block.input);
      lines.push(
        toActivityLine(target ? `→ ${block.name}: ${target}` : `→ ${block.name}`),
      );
    }
  }
  return lines;
}

function toolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      const text = (part as { text?: unknown } | null | undefined)?.text;
      return typeof text === "string" ? text : "";
    })
    .join(" ");
}

/**
 * Tool results only matter when they failed: the successful ones are file
 * contents and command output, which would bury the actual progress.
 */
function describeToolResults(message: unknown): string[] {
  const lines: string[] = [];
  for (const block of contentBlocks(message)) {
    if (block.type !== "tool_result" || block.is_error !== true) continue;
    const text = toolResultText(block.content).trim();
    lines.push(
      toActivityLine(text ? `⚠ Tool-Fehler: ${text}` : "⚠ Tool-Fehler"),
    );
  }
  return lines;
}

/**
 * One raw line of the Claude event stream -> the activity lines it should show.
 * Unknown event types produce nothing; a line that is not JSON at all (plain
 * CLI/stderr output) is passed through, so real errors stay visible.
 */
export function describeEvent(line: string): string[] {
  const raw = line.trim();
  if (!raw || STDIN_WARNING.test(raw)) return [];

  let event: unknown;
  try {
    event = JSON.parse(raw);
  } catch {
    return [toActivityLine(raw)];
  }
  if (!event || typeof event !== "object") return [];

  const e = event as {
    type?: unknown;
    subtype?: unknown;
    model?: unknown;
    message?: unknown;
    result?: unknown;
  };
  switch (typeof e.type === "string" ? e.type : "") {
    case "system":
      if (e.subtype !== "init") return [];
      return [
        toActivityLine(
          typeof e.model === "string"
            ? `Claude Code gestartet (${e.model})`
            : "Claude Code gestartet",
        ),
      ];
    case "assistant":
      return describeAssistant(e.message);
    case "user":
      return describeToolResults(e.message);
    case "result": {
      const text =
        typeof e.result === "string" ? e.result : String(e.subtype ?? "");
      return [toActivityLine(`Claude fertig: ${text}`)];
    }
    default:
      return [];
  }
}

/**
 * The final answer of a stream-json run: the `result` field of the last
 * "result" event. Falls back to the raw output when there is none (CLI error,
 * killed run), so the run log always gets something loggable (req-004).
 */
export function finalResultText(stdout: string): string {
  let result: string | null = null;
  for (const line of stdout.split("\n")) {
    const raw = line.trim();
    if (!raw.startsWith("{")) continue;
    try {
      const e = JSON.parse(raw) as { type?: unknown; result?: unknown };
      if (e.type === "result" && typeof e.result === "string") result = e.result;
    } catch {
      /* not an event line */
    }
  }
  return (result ?? stdout).trim();
}
