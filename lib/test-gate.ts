import { promises as fs } from "node:fs";
import path from "node:path";
import { run, type RunResult } from "./workspace";

// The test gate a file-driven requirement has to pass before it may be called
// finished (req-019). Until now the worker filed a .md under done/ as soon as
// Claude said it was done — which once put a requirement into done/ while the
// suite was red (a dependency that existed only in the worker's container), and
// that only surfaced at promotion time.
//
// So "fertig" is no longer a sentence somebody wrote, it is a fact this module
// establishes: the repo's own test command, taken from its delivery/stack.md,
// runs and comes back green. The same reason the Ideen task reads its folder
// instead of Claude's answer (req-011) and the Doku task reads its screenshot
// results instead of the prose around them (req-017).
//
// Why the install command runs first, and why the dependency folder is thrown
// away before it: the requirement counts the state of a FRESH CHECKOUT, not the
// state of a long-lived worker working copy. A package that is only installed
// locally survives `git clean -fd` (node_modules is ignored, not untracked), so
// a suite that is green here can be red for everyone else. Installing from the
// declared manifest into an empty folder is what makes that difference visible.

/**
 * The repo file that names the commands. Its `## Commands` list is a machine
 * contract of the setup-stack skill (labels and backticked commands stay put in
 * every language), which is why the test command can be read out of it.
 */
export const STACK_FILE = "delivery/stack.md";

/**
 * The folder an install command fills. Removed before the install so the suite
 * runs against what the manifest declares and not against what some earlier run
 * happened to leave behind.
 */
export const DEPENDENCY_DIR = "node_modules";

/**
 * Environment for the install step so it pulls devDependencies even though the
 * worker container sets NODE_ENV=production (bug-010): the test runner lives in
 * devDependencies, and a production install would leave it out. All three keys
 * say the same thing to npm across versions; harmless for non-npm installers.
 */
export const DEV_INSTALL_ENV: Record<string, string> = {
  NODE_ENV: "development",
  NPM_CONFIG_PRODUCTION: "false",
  NPM_CONFIG_INCLUDE: "dev",
};

/** How long install and test may each take before they count as failed. */
export const TEST_TIMEOUT_MS = 30 * 60_000;

/** What the Verlauf says when the repo names no test command at all. */
export const NO_TEST_COMMAND_MESSAGE = `kein Test-Befehl in ${STACK_FILE} hinterlegt`;

/** What the Verlauf says when a declared command could not be run at all. */
export const NOT_RUNNABLE_MESSAGE = "Tests nicht ausführbar — ungeprüft";

/** What the Verlauf says when the gate passed. */
export const GATE_GREEN_MESSAGE = "Test-Suite grün";

/** What the Verlauf leads with when the gate did not pass. */
export const GATE_RED_MESSAGE = "Test-Suite rot";

/**
 * green — the full suite ran and passed.
 * red   — install or suite RAN and failed; `reason` says how. Only this blocks.
 * no-command — the repo declares no test command, so there is no suite to run.
 * not-runnable — a command IS declared but could not be executed at all (shell
 *   syntax the worker won't spawn, or the tool is not installed / "command not
 *   found"). Distinct from red: "we could not check" must not be treated as a
 *   real red failure (req-025), so this lets the run through as unchecked.
 */
export type GateStatus = "green" | "red" | "no-command" | "not-runnable";

export type TestGateResult = {
  status: GateStatus;
  /** The command whose outcome this is, or null when none could be run. */
  command: string | null;
  /** Short, loggable cause. Empty when the gate is green. */
  reason: string;
};

export type TestGateDeps = {
  /** Seam for the child processes, so the gate is testable without npm. */
  runImpl?: typeof run;
  /** Seam for emptying the dependency folder. */
  removeDir?: (dirPath: string) => Promise<void>;
  timeoutMs?: number;
};

/** The `## Commands` section of stack.md — a machine contract per the skill. */
const COMMANDS_HEADING = /^#{1,6}\s+.*(commands|befehle)/i;
const ANY_HEADING = /^#{1,6}\s/;
/** A list row: "- Test:    `npm test` (Vitest, …)". */
const COMMAND_ROW = /^[-*]\s*([^:]+):\s*(.*)$/;

/**
 * The command a labelled row of the `## Commands` list names, or null. Only a
 * backticked value counts: the template writes every real command in backticks,
 * so a row like "Format: Prettier noch nicht eingerichtet" says "no command"
 * instead of handing prose to a spawn.
 */
function commandFrom(
  stack: string | null | undefined,
  label: RegExp,
): string | null {
  if (!stack) return null;
  const lines = stack.split("\n");
  const start = lines.findIndex((l) => COMMANDS_HEADING.test(l.trim()));
  if (start < 0) return null;

  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (ANY_HEADING.test(line)) break; // next section: the list is over
    const row = line.match(COMMAND_ROW);
    if (!row) continue;
    if (!label.test(row[1].trim())) continue;
    const code = row[2].match(/`([^`]+)`/);
    const value = code ? code[1].trim() : "";
    if (value) return value;
  }
  return null;
}

/**
 * The repo's full-suite command, e.g. `npm test`. Matched on the exact label, so
 * neither the `E2E:` row next to it nor a `Test:watch` variant can stand in for
 * the one command that decides whether a requirement is finished.
 */
export function testCommandFrom(stack: string | null | undefined): string | null {
  return commandFrom(stack, /^test$/i);
}

/** The repo's install command, e.g. `npm install`. */
export function installCommandFrom(
  stack: string | null | undefined,
): string | null {
  return commandFrom(stack, /^install$/i);
}

/**
 * Program and arguments of a declared command, or null when it is nothing the
 * worker can spawn. Shell syntax lands in the null case on purpose: the worker
 * runs its children without a shell, so `a && b` would be handed to a program
 * called "a" — better to say "not runnable" than to run half of it.
 */
export function splitCommand(
  command: string,
): { cmd: string; args: string[] } | null {
  if (/[;&|<>$`\n]/.test(command)) return null;
  const parts = command.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return { cmd: parts[0], args: parts.slice(1) };
}

/**
 * Why a run counts as failed, short enough for a run-log row. The tail is what
 * matters: a test runner prints its summary last, so the last few hundred
 * characters are the ones that name the failing test.
 */
export function failureTail(res: RunResult, max = 400): string {
  if (res.code === 124) return "Timeout";
  const text = [res.stdout, res.stderr]
    .join("\n")
    .split("\n")
    .map((l) => l.trimEnd())
    .filter((l) => l.trim())
    .join("\n");
  const tail = text.slice(-max).trim();
  return tail || `Exit-Code ${res.code}`;
}

async function exec(
  runImpl: typeof run,
  command: string,
  dir: string,
  timeoutMs: number,
  env?: Record<string, string>,
): Promise<TestGateResult | null> {
  const parts = splitCommand(command);
  if (!parts) {
    // Shell syntax the worker won't spawn: a declared-but-unrunnable command,
    // not a red suite (req-025).
    return {
      status: "not-runnable",
      command,
      reason: `${command}: kein ausführbarer Befehl`,
    };
  }
  const res = await runImpl(parts.cmd, parts.args, {
    cwd: dir,
    timeoutMs,
    // Nothing is piped in; an open pipe makes some CLIs wait for input.
    stdin: "ignore",
    env,
  });
  if (res.ok) return null;
  // Exit 127 = the program itself was not found (tool not installed). That is
  // "could not run the suite", not "the suite failed" — so it does not block
  // like a red run (req-025).
  if (res.code === 127) {
    return {
      status: "not-runnable",
      command,
      reason: `${command}: ${failureTail(res)}`,
    };
  }
  return { status: "red", command, reason: `${command}: ${failureTail(res)}` };
}

/**
 * Run the repo's full test suite in `dir` and report whether it is green
 * (req-019).
 *
 * Never throws: a gate that cannot be established is a red gate with a reason,
 * because "we could not check" must not read like "it passed".
 */
export async function runTestGate(
  dir: string,
  stack: string | null,
  deps: TestGateDeps = {},
): Promise<TestGateResult> {
  const test = testCommandFrom(stack);
  if (!test) {
    return { status: "no-command", command: null, reason: NO_TEST_COMMAND_MESSAGE };
  }

  const runImpl = deps.runImpl ?? run;
  const timeoutMs = deps.timeoutMs ?? TEST_TIMEOUT_MS;
  const removeDir =
    deps.removeDir ??
    ((p: string) => fs.rm(p, { recursive: true, force: true }));

  // Fresh-checkout semantics (req-019): install from the declared manifest into
  // an empty dependency folder, so a package that lives only in this container
  // cannot keep the suite green. Only done when there IS an install command —
  // without one, emptying the folder would just break the run.
  const install = installCommandFrom(stack);
  if (install) {
    await removeDir(path.join(dir, DEPENDENCY_DIR)).catch(() => {});
    // The worker container runs with NODE_ENV=production, which `run` inherits
    // into every child. A production install skips devDependencies — and the
    // test runner (vitest etc.) lives there, so the suite would fail with "not
    // found" (bug-010). Force a dev install for this one step so the test tools
    // are present; the test command below still runs in the normal environment.
    const installFailed = await exec(runImpl, install, dir, timeoutMs, DEV_INSTALL_ENV);
    if (installFailed) return installFailed;
  }

  const testFailed = await exec(runImpl, test, dir, timeoutMs);
  if (testFailed) return testFailed;
  return { status: "green", command: test, reason: "" };
}

/**
 * What the Verlauf appends about a gate that let the run through — green, or
 * green-by-absence. A gate whose outcome is invisible would be no gate at all:
 * a repo that never declared a test command has to say so on every run it
 * finishes, not stay quiet about it.
 */
export function testGateNote(gate: TestGateResult): string {
  if (gate.status === "no-command") return ` (${NO_TEST_COMMAND_MESSAGE})`;
  if (gate.status === "not-runnable") {
    return ` (${NOT_RUNNABLE_MESSAGE}: ${gate.reason})`;
  }
  return ` (${GATE_GREEN_MESSAGE}: ${gate.command})`;
}
