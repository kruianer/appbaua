// Die Schritte eines Chat-Zugs als Zeitstrahl (req-051): je Werkzeugaufruf ein
// Eintrag mit Art, Ziel, Status und Ergebnis. Liest denselben Roh-Ereignisstrom
// (`stream-json`) wie describeEvent (claude-events.ts), behält aber, was dort
// zu Textzeilen eingedampft wird: ob der Schritt noch läuft, geklappt hat oder
// fehlgeschlagen ist, und was er ausgegeben hat.
//
// Pure und ohne DOM — der Server baut damit den Stand auf, die Oberfläche
// liest ihn (auch alte, als Textzeilen gespeicherte Schritte, siehe
// parseChatSteps).

import { toolResultText, toolTarget } from "./claude-events";

export type ChatStepStatus = "running" | "ok" | "error";

export type ChatStep = {
  id: string;
  tool: string;
  target: string;
  status: ChatStepStatus;
  /** Ausgabe des Befehls bzw. Inhalt der Änderung; fehlt, solange nichts da ist. */
  result?: string;
};

/** Ein Ergebnis wird nicht unbegrenzt gespeichert (eine Ausgabe kann Megabytes haben). */
export const MAX_RESULT_CHARS = 100_000;

function cap(text: string): string {
  return text.length <= MAX_RESULT_CHARS
    ? text
    : `${text.slice(0, MAX_RESULT_CHARS)}\n… (gekürzt)`;
}

const lines = (text: string, prefix: string) =>
  text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");

/** Der Inhalt einer Änderung steht im Aufruf, nicht im (knappen) Ergebnis. */
function changeContent(tool: string, input: unknown): string | undefined {
  if (!input || typeof input !== "object") return undefined;
  const i = input as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  if (tool === "Edit" && str(i.old_string) !== undefined && str(i.new_string) !== undefined) {
    return `${lines(str(i.old_string)!, "- ")}\n${lines(str(i.new_string)!, "+ ")}`;
  }
  if (tool === "Write" && str(i.content) !== undefined) return str(i.content);
  return undefined;
}

export function createStepTracker(scrub: (text: string) => string = (t) => t) {
  const steps: ChatStep[] = [];
  const byId = new Map<string, ChatStep>();
  return {
    /** Eine rohe Zeile des Ereignisstroms; alles Unbekannte wird ignoriert. */
    push(line: string): void {
      const raw = line.trim();
      if (!raw.startsWith("{")) return;
      let event: { type?: unknown; message?: { content?: unknown } };
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }
      const content = event?.message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content as Record<string, unknown>[]) {
        if (event.type === "assistant" && block.type === "tool_use" && typeof block.name === "string") {
          const step: ChatStep = {
            id: typeof block.id === "string" ? block.id : `s${steps.length}`,
            tool: block.name,
            target: toolTarget(block.input),
            status: "running",
          };
          const change = changeContent(block.name, block.input);
          if (change) step.result = cap(change);
          steps.push(step);
          byId.set(step.id, step);
        } else if (event.type === "user" && block.type === "tool_result") {
          const step = byId.get(String(block.tool_use_id));
          if (!step) continue;
          step.status = block.is_error === true ? "error" : "ok";
          const text = toolResultText(block.content).trim();
          if (text && (block.is_error === true || step.result === undefined)) step.result = cap(text);
        }
      }
    },
    // Geschwärzt wird je Feld beim Herausgeben, nie das fertige JSON.
    steps: (): ChatStep[] =>
      steps.map((s) => ({
        ...s,
        target: scrub(s.target),
        ...(s.result !== undefined ? { result: scrub(s.result) } : {}),
      })),
    serialize(): string | undefined {
      return steps.length ? JSON.stringify(this.steps()) : undefined;
    },
  };
}

/**
 * Gespeicherte/gelieferte Schritte -> Liste. Neu: JSON. Alt (req-049): Textzeilen
 * "→ Bash: npm test" — sie bekommen Art und Ziel, aber weder Status noch Ergebnis
 * (gelten als geklappt, sie sind ja vorbei).
 */
export function parseChatSteps(text: string): ChatStep[] {
  const t = text.trim();
  if (t.startsWith("[")) {
    try {
      const parsed = JSON.parse(t);
      if (Array.isArray(parsed)) return parsed as ChatStep[];
    } catch {
      /* fällt auf Textzeilen zurück */
    }
  }
  return t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l, i) => {
      const m = l.match(/^→ ([^:]+?)(?:: (.*))?$/);
      return { id: `legacy${i}`, tool: m ? m[1] : l, target: m?.[2] ?? "", status: "ok" as const };
    });
}
