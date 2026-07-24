import { run, type RunResult } from "./workspace";

// Invokes Claude Code headless to work a task (req-006). Fully autonomous: the
// CLI runs non-interactively with permissions skipped so it never asks. Auth is
// the user's Anthropic subscription (via `claude login`, mounted into the
// container) — NOT an API key, so no usage costs. Coding always uses Opus. A
// run is capped at CLAUDE_TIMEOUT_MS; on timeout or a missing CLI it returns a
// clean failure (never throws), so the worker logs "Fehler" and moves on.

export const CLAUDE_TIMEOUT_MS = 60 * 60_000; // 60 minutes
export const CLAUDE_MODEL = "opus";

/** How much of the running output is published live, and how often (req-008). */
export const LIVE_TAIL_LINES = 50;
export const LIVE_THROTTLE_MS = 1000;

export type ClaudeOutcome = {
  ok: boolean;
  summary: string;
};

/** The last `n` lines of `text` (fewer if there are not that many). */
export function lastLines(text: string, n: number = LIVE_TAIL_LINES): string {
  const lines = text.split("\n");
  return lines.slice(Math.max(0, lines.length - n)).join("\n");
}

/**
 * Accumulates process output and hands the current tail to `emit` at most once
 * per `intervalMs` (req-008). The first chunk goes out right away so the
 * Aktivität tab shows something as soon as Claude says anything; everything
 * after that is throttled, because writing the status on every chunk would
 * hammer the database.
 */
export function createLiveTail(
  emit: (tail: string) => void,
  opts: { intervalMs?: number; lines?: number; now?: () => number } = {},
): (chunk: string) => void {
  const intervalMs = opts.intervalMs ?? LIVE_THROTTLE_MS;
  const lines = opts.lines ?? LIVE_TAIL_LINES;
  const now = opts.now ?? (() => Date.now());
  let buffer = "";
  let lastEmit: number | null = null;
  return (chunk: string) => {
    // Trim on every chunk: only the tail is ever published, so the buffer of a
    // one-hour run stays bounded.
    buffer = lastLines(buffer + chunk, lines);
    const t = now();
    if (lastEmit !== null && t - lastEmit < intervalMs) return;
    lastEmit = t;
    emit(buffer);
  };
}

/** The prompt handed to Claude Code for a file-driven task. */
export function fileTaskPrompt(mdRelPath: string): string {
  return [
    `Arbeite die Aufgabe in der Datei ${mdRelPath} vollständig ab.`,
    `Halte dich an die CLAUDE.md und die Konventionen dieses Repos.`,
    `Setze die Anforderung/den Bugfix um, schreibe/aktualisiere Tests,`,
    `und stelle sicher, dass das Quality Gate grün ist.`,
    `Committe NICHT selbst und pushe NICHT — das übernimmt der Worker.`,
    `Arbeite vollständig autonom; frage nichts.`,
  ].join(" ");
}

/** The prompt for a recurring task (code-review, doku, ...). */
export function recurringPrompt(kindLabel: string): string {
  return [
    `Führe eine ${kindLabel} für dieses Repo durch, autonom und ohne Rückfragen.`,
    `Halte dich an die CLAUDE.md und die Konventionen dieses Repos.`,
    `Committe/pushe NICHT selbst.`,
  ].join(" ");
}

/**
 * Run Claude Code in `dir` with `prompt`. Injectable runner for tests.
 */
export async function runClaude(
  dir: string,
  prompt: string,
  deps?: {
    runImpl?: typeof run;
    timeoutMs?: number;
    /**
     * Receives the last ~50 output lines while the run is still going
     * (req-008), at most about once per second. Errors from it are swallowed —
     * live output must never break the run.
     */
    onOutput?: (tail: string) => void;
    /** Clock for the throttle; injectable for tests. */
    now?: () => number;
  },
): Promise<ClaudeOutcome> {
  const runImpl = deps?.runImpl ?? run;
  const timeoutMs = deps?.timeoutMs ?? CLAUDE_TIMEOUT_MS;
  const onOutput = deps?.onOutput;
  const onData = onOutput
    ? createLiveTail(onOutput, { now: deps?.now })
    : undefined;

  let res: RunResult;
  try {
    res = await runImpl(
      "claude",
      ["-p", prompt, "--model", CLAUDE_MODEL, "--dangerously-skip-permissions"],
      { cwd: dir, timeoutMs, onData },
    );
  } catch (err) {
    return { ok: false, summary: `Claude-Aufruf fehlgeschlagen: ${String(err)}` };
  }

  if (res.code === 127) {
    return { ok: false, summary: "Claude-Code-CLI nicht verfügbar" };
  }
  if (res.code === 124) {
    return { ok: false, summary: "Claude-Lauf: Timeout (60 min)" };
  }
  if (!res.ok) {
    const tail = (res.stderr || res.stdout).trim().slice(-300);
    return { ok: false, summary: `Claude-Lauf fehlgeschlagen: ${tail}` };
  }
  const tail = res.stdout.trim().slice(-300);
  return { ok: true, summary: tail || "Claude-Lauf erfolgreich" };
}
