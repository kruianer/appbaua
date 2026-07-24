import { run, type RunResult } from "./workspace";

// Invokes Claude Code headless to work a task (req-006). Fully autonomous: the
// CLI runs non-interactively with permissions skipped so it never asks. Auth is
// the user's Anthropic subscription (via `claude login`, mounted into the
// container) — NOT an API key, so no usage costs. Coding always uses Opus. A
// run is capped at CLAUDE_TIMEOUT_MS; on timeout or a missing CLI it returns a
// clean failure (never throws), so the worker logs "Fehler" and moves on.

export const CLAUDE_TIMEOUT_MS = 60 * 60_000; // 60 minutes
export const CLAUDE_MODEL = "opus";

export type ClaudeOutcome = {
  ok: boolean;
  summary: string;
};

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
  deps?: { runImpl?: typeof run; timeoutMs?: number },
): Promise<ClaudeOutcome> {
  const runImpl = deps?.runImpl ?? run;
  const timeoutMs = deps?.timeoutMs ?? CLAUDE_TIMEOUT_MS;

  let res: RunResult;
  try {
    res = await runImpl(
      "claude",
      ["-p", prompt, "--model", CLAUDE_MODEL, "--dangerously-skip-permissions"],
      { cwd: dir, timeoutMs },
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
