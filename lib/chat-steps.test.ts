import { describe, expect, it } from "vitest";
import { createStepTracker, parseChatSteps, MAX_RESULT_CHARS } from "./chat-steps";

const use = (id: string, name: string, input: Record<string, unknown>) =>
  JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } });
const res = (id: string, content: unknown, isError = false) =>
  JSON.stringify({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
  });

describe("createStepTracker (req-051)", () => {
  it("ein laufender Befehl ist 'running', ohne Ergebnis", () => {
    const t = createStepTracker();
    t.push(use("a", "Bash", { command: "npm test" }));
    expect(t.steps()).toEqual([{ id: "a", tool: "Bash", target: "npm test", status: "running" }]);
  });

  it("ein erfolgreicher Befehl ist 'ok' und trägt seine Ausgabe", () => {
    const t = createStepTracker();
    t.push(use("a", "Bash", { command: "npm test" }));
    t.push(res("a", "alles grün"));
    expect(t.steps()[0]).toMatchObject({ status: "ok", result: "alles grün" });
  });

  it("ein fehlgeschlagener Befehl ist 'error' und trägt seine Ausgabe", () => {
    const t = createStepTracker();
    t.push(use("a", "Bash", { command: "npm test" }));
    t.push(res("a", [{ type: "text", text: "3 failed" }], true));
    expect(t.steps()[0]).toMatchObject({ status: "error", result: "3 failed" });
  });

  it("der Inhalt einer Änderung steht im Ergebnis", () => {
    const t = createStepTracker();
    t.push(use("e", "Edit", { file_path: "a.ts", old_string: "x", new_string: "y" }));
    t.push(res("e", "The file a.ts has been updated"));
    expect(t.steps()[0]).toMatchObject({ target: "a.ts", status: "ok", result: "- x\n+ y" });
  });

  it("kappt riesige Ausgaben und ignoriert Unbekanntes", () => {
    const t = createStepTracker();
    t.push("kein json");
    t.push(JSON.stringify({ type: "system" }));
    t.push(res("nirgends", "x"));
    t.push(use("a", "Bash", { command: "cat" }));
    t.push(res("a", "z".repeat(MAX_RESULT_CHARS * 2)));
    expect(t.steps()).toHaveLength(1);
    expect(t.steps()[0].result!.length).toBeLessThan(MAX_RESULT_CHARS + 50);
  });

  it("schwärzt Ziel und Ergebnis, ohne das JSON zu zerbrechen", () => {
    const t = createStepTracker((x) => x.replace(/geheim/g, "***"));
    t.push(use("a", "Bash", { command: 'echo "geheim"' }));
    t.push(res("a", 'geheim "x"'));
    const parsed = JSON.parse(t.serialize()!);
    expect(parsed[0]).toMatchObject({ target: 'echo "***"', result: '*** "x"' });
  });

  it("serialize ist leer ohne Schritte", () => {
    expect(createStepTracker().serialize()).toBeUndefined();
  });
});

describe("parseChatSteps", () => {
  it("liest JSON", () => {
    const json = JSON.stringify([{ id: "a", tool: "Bash", target: "ls", status: "ok" }]);
    expect(parseChatSteps(json)).toEqual([{ id: "a", tool: "Bash", target: "ls", status: "ok" }]);
  });

  it("liest alte Textzeilen aus req-049", () => {
    expect(parseChatSteps("→ Bash: npm test\n→ Read: a.ts")).toMatchObject([
      { tool: "Bash", target: "npm test", status: "ok" },
      { tool: "Read", target: "a.ts" },
    ]);
  });
});
