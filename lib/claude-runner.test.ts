import { describe, it, expect } from "vitest";
import {
  createActivityStream,
  createLiveTail,
  docPrompt,
  ideaPrompt,
  lastLines,
  recurringPrompt,
  runClaude,
  securityPrompt,
  LIVE_TAIL_LINES,
  NO_IDEA_MESSAGE,
} from "./claude-runner";
import { SECURITY_OK_MESSAGE } from "./security-report";
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

describe("recurringPrompt (req-010)", () => {
  it("names the task and asks for the complete report as the final answer", () => {
    const p = recurringPrompt("Code-Review");
    expect(p).toContain("Code-Review");
    expect(p).toContain("vollständigen Bericht");
    expect(p).toContain("Committe/pushe NICHT selbst.");
  });
});

// req-011: the Ideen task used to fall through to recurringPrompt ("Führe eine
// Ideen für dieses Repo durch"), which asks for a review report — not for an
// idea file. The prompt below is the only place that can rule out duplicates,
// already-implemented ideas and off-direction proposals, so each of those
// instructions is pinned here.
describe("ideaPrompt (req-011)", () => {
  const p = ideaPrompt({
    ideaDir: "delivery/idea",
    doneDir: "delivery/idea/done",
    directionFile: "delivery/idea-direction.md",
  });

  it("asks for exactly one new idea", () => {
    expect(p).toContain("GENAU EINE neue Idee");
  });

  it("AC: names the open ideas, the implemented ones and the direction as input", () => {
    expect(p).toContain("delivery/idea/");
    expect(p).toContain("delivery/idea/done/");
    expect(p).toContain("delivery/idea-direction.md");
  });

  it("AC: rules out duplicates of open and of already implemented ideas", () => {
    expect(p).toContain("Dublette");
    expect(p).toContain("umgesetzten Idee");
  });

  it("AC: falls back to a free proposal when there is no direction", () => {
    expect(p).toContain("gibt es keine Richtungs-Vorgabe");
  });

  it("AC: prescribes the shape of the idea file", () => {
    expect(p).toContain("Frontmatter");
    expect(p).toContain("titel, datum");
    expect(p).toContain("## Problem/Nutzen");
    expect(p).toContain("## Skizze");
  });

  it("AC: says what to do when there is no new idea — no file, fixed answer", () => {
    expect(p).toContain("lege KEINE Datei an");
    expect(p).toContain(NO_IDEA_MESSAGE);
  });

  it("leaves committing and pushing to the worker", () => {
    expect(p).toContain("Committe/pushe NICHT selbst.");
  });

  it("asks for no report — the idea file IS the result", () => {
    expect(p).not.toContain("Bericht");
  });
});

// req-014: the Security task asks for a report only when there IS something to
// report — and it must not change the repo. Both, plus the four areas and the
// shape of a finding, can only be stated here.
describe("securityPrompt (req-014)", () => {
  const p = securityPrompt({ policyFile: "delivery/security.md" });

  it("AC: reads the repo's security policy as the target state", () => {
    expect(p).toContain("delivery/security.md");
    expect(p).toContain("SOLL");
  });

  it("AC: falls back to best practices and says so in the report", () => {
    expect(p).toContain("Best-Practices");
    expect(p).toContain("keine repo-spezifische Vorgabe vorlag");
  });

  it("AC: names all four areas that get checked", () => {
    expect(p).toContain("Zugriff & Erreichbarkeit");
    expect(p).toContain("Datenschutz & Datenhaltung");
    expect(p).toContain("Backup & Wiederherstellung");
    expect(p).toContain("Abhängigkeiten & bekannte Lücken");
  });

  it("AC: asks for a summary, a severity, a recommendation and live-vs-derived", () => {
    expect(p).toContain("Kurz-Zusammenfassung");
    expect(p).toContain("hoch/mittel/niedrig");
    expect(p).toContain("Empfehlung");
    expect(p).toContain("live verifiziert");
  });

  it("AC: no finding -> no report, fixed answer", () => {
    expect(p).toContain("KEINEN Bericht");
    expect(p).toContain(SECURITY_OK_MESSAGE);
  });

  it("changes nothing and leaves committing to the worker", () => {
    expect(p).toContain("Ändere NICHTS im Repo");
    expect(p).toContain("Committe/pushe NICHT selbst.");
  });
});

// req-016: the Doku task produces a website, not a report. Following the design
// template, writing only into site/user-docs/ and — above all — UPDATING the
// existing pages instead of rebuilding them are things nothing but this prompt
// can ask for, so each of them is pinned here.
describe("docPrompt (req-016)", () => {
  const p = docPrompt({
    designDir: "delivery/doc-design",
    docSiteFile: "delivery/doc-site.md",
    docsDir: "site/user-docs",
    doneRequirementsDir: "delivery/requirements/done",
  });

  it("AC: reads the design template and follows it as far as possible", () => {
    expect(p).toContain("delivery/doc-design/");
    expect(p).toContain("Handover-Markdown");
    expect(p).toContain("SO WEIT WIE MÖGLICH");
    expect(p).toContain("Orientierung, kein");
  });

  it("AC: derives the content from the shipped requirements and the code", () => {
    expect(p).toContain("delivery/requirements/done/");
    expect(p).toContain("Code");
    expect(p).toContain("Sicht der Nutzer");
  });

  it("AC: updates incrementally instead of rebuilding the site", () => {
    expect(p).toContain("INKREMENTELL");
    expect(p).toContain("vorhandenen Seiten in site/user-docs/");
    expect(p).toContain("NICHT bei jedem Lauf neu");
    expect(p).toContain("nicht bei jedem Lauf anders aussehen");
  });

  it("asks for a multi-page site under the shared web root", () => {
    expect(p).toContain("mehrseitige");
    expect(p).toContain("site/user-docs/");
  });

  it("touches nothing outside the docs folder and leaves the push to the worker", () => {
    expect(p).toContain("Ändere sonst NICHTS im Repo");
    expect(p).toContain("Committe/pushe NICHT selbst");
  });

  it("asks for no report — the pages ARE the result", () => {
    expect(p).not.toContain("Bericht");
  });
});

// req-017: the pictures the worker already took are handed over as a CLOSED
// list. Where they go is Claude's decision; which of them exist is not — a page
// pointing at a screenshot that was never taken is exactly the broken image the
// requirement rules out.
describe("docPrompt — Screenshots (req-017)", () => {
  const withShots = docPrompt({
    designDir: "delivery/doc-design",
    docSiteFile: "delivery/doc-site.md",
    docsDir: "site/user-docs",
    doneRequirementsDir: "delivery/requirements/done",
    screenshots: [
      { page: "/", rel: "site/user-docs/assets/screenshots/start.png" },
      { page: "/verlauf", rel: "site/user-docs/assets/screenshots/verlauf.png" },
    ],
  });
  const withoutShots = docPrompt({
    designDir: "delivery/doc-design",
    docSiteFile: "delivery/doc-site.md",
    docsDir: "site/user-docs",
    doneRequirementsDir: "delivery/requirements/done",
    screenshots: [],
  });

  it("AC: names every available picture and what it shows", () => {
    expect(withShots).toContain("site/user-docs/assets/screenshots/start.png");
    expect(withShots).toContain("site/user-docs/assets/screenshots/verlauf.png");
    expect(withShots).toContain("zeigt /verlauf");
  });

  it("AC: asks for them to be placed where the docs talk about that page", () => {
    expect(withShots).toContain("Binde jeden davon dort ein");
    expect(withShots).toContain("alt-Text");
  });

  it("AC: allows no picture beyond the ones that exist", () => {
    expect(withShots).toContain("AUSSCHLIESSLICH diese Bilder");
    expect(withShots).toContain("keine Bild-Datei, die es nicht gibt");
  });

  it("AC: without pictures it asks for a doc without images, not for broken ones", () => {
    expect(withoutShots).toContain("KEINE neuen Screenshots");
    expect(withoutShots).toContain("ohne neue Bilder");
    expect(withoutShots).toContain("KEINE Bild-Datei, die es nicht gibt");
  });

  it("defaults to the no-pictures wording when nobody says otherwise", () => {
    const noKey = docPrompt({
      designDir: "delivery/doc-design",
      docSiteFile: "delivery/doc-site.md",
      docsDir: "site/user-docs",
      doneRequirementsDir: "delivery/requirements/done",
    });
    expect(noKey).toContain("KEINE neuen Screenshots");
  });
});

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

  it("req-027: onModel fires once with the model the init event names", async () => {
    const clock = { t: 0 };
    const models: string[] = [];
    await runClaude("/repo", "prompt", {
      runImpl: streamingRun(clock),
      onOutput: () => {},
      onModel: (m) => models.push(m),
      now: () => clock.t,
    });
    expect(models).toEqual(["opus"]); // EVENTS' init event names "opus"
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

  it("req-026: a timeout keeps the last activity so a rate-limit hang is visible", async () => {
    // The killed run has no final "result" event; the raw tail is what remains.
    const runImpl: typeof run = async () => ({
      ok: false,
      code: 124,
      stdout: "…usage limit reached, waiting…",
      stderr: "",
    });
    const out = await runClaude("/repo", "prompt", { runImpl });
    expect(out.ok).toBe(false);
    expect(out.summary).toContain("Timeout");
    expect(out.summary).toContain("zuletzt");
    expect(out.summary).toContain("usage limit reached");
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

  // req-010: the report that gets filed in the repo is Claude's final answer,
  // so it must be the whole report — and the log must keep only its tail.
  it("AC: a successful run reports the FULL answer next to the short summary", async () => {
    const long = `${"x".repeat(1000)}\nFazit: Tests gruen.`;
    const stdout = `${JSON.stringify({
      type: "result",
      subtype: "success",
      result: long,
    })}\n`;
    const runImpl: typeof run = async () => ({
      ok: true,
      code: 0,
      stdout,
      stderr: "",
    });
    const out = await runClaude("/repo", "prompt", { runImpl });
    expect(out.report).toBe(long);
    expect(out.summary.length).toBeLessThanOrEqual(300);
    expect(out.summary).not.toBe(out.report);
  });

  it("a failed run carries no report — nothing gets filed", async () => {
    const runImpl: typeof run = async () => ({
      ok: false,
      code: 1,
      stdout: STDOUT,
      stderr: "claude: boom\n",
    });
    expect((await runClaude("/repo", "prompt", { runImpl })).report).toBe("");
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
