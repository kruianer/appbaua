import { describe, it, expect } from "vitest";
import {
  ANALYSIS_SYSTEM_PROMPT,
  DEFAULT_ANALYSIS_MODELS,
  NO_FINDING_TEXT,
  SCRUBBED,
  analysisIsDue,
  buildAnalysisPrompt,
  buildAnalysisRequest,
  buildLogBundle,
  extractReplyText,
  normalizeAnalyses,
  parseAnalysisReply,
  scrubLogs,
  tailLines,
} from "./log-analysis";

// req-035, reine Logik: was an die KI geht, wie gefragt wird und wie die
// Antwort gedeutet wird.

describe("scrubLogs — was NICHT hinausgeht", () => {
  it("entfernt Zugangsdaten aus Zuweisungen", () => {
    const text = [
      "DB_PASSWORD=hunter2",
      'api_key: "sk-abcdefghijklmnopqrstuvwx"',
      "AUTH_TOKEN = abc123def456",
    ].join("\n");
    const out = scrubLogs(text);
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("sk-abcdefghijklmnopqrstuvwx");
    expect(out).not.toContain("abc123def456");
    expect(out).toContain(SCRUBBED);
  });

  it("entfernt Bearer-Token und JSON Web Token", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dBjftJeZ4CVPmB92K27u";
    const out = scrubLogs(`Authorization Bearer abcdefghijklmnop\ntoken ${jwt}`);
    expect(out).not.toContain("abcdefghijklmnop");
    expect(out).not.toContain(jwt);
  });

  it("entfernt E-Mail-Adressen — personenbezogen und für einen Befund nie nötig", () => {
    expect(scrubLogs("login failed for uwe@kremmel.org")).toBe(
      `login failed for ${SCRUBBED}`,
    );
  });

  it("entfernt öffentliche IP-Adressen, lässt die des eigenen Netzes stehen", () => {
    const out = scrubLogs("from 93.184.216.34 via 192.168.1.5 and 127.0.0.1");
    expect(out).not.toContain("93.184.216.34");
    expect(out).toContain("192.168.1.5");
    expect(out).toContain("127.0.0.1");
  });

  it("lässt gewöhnliche Meldungen unangetastet", () => {
    const line = "ERROR out of memory in worker 3 after 12 retries";
    expect(scrubLogs(line)).toBe(line);
  });
});

describe("Menge der übertragenen Logzeilen", () => {
  it("nimmt nur die jüngsten Zeilen", () => {
    const text = Array.from({ length: 500 }, (_, i) => `Zeile ${i}`).join("\n");
    const out = tailLines(text, 10);
    expect(out.split("\n")).toHaveLength(10);
    expect(out).toContain("Zeile 499");
    expect(out).not.toContain("Zeile 100");
  });

  it("kürzt das Gesamtpaket sichtbar, statt stillschweigend", () => {
    const bundle = buildLogBundle(
      [{ name: "lgt-prod-app", text: "x".repeat(5000) }],
      200,
    );
    expect(bundle.length).toBeLessThanOrEqual(300);
    expect(bundle).toContain("gekürzt");
  });

  it("nennt je Container seinen Namen und bereinigt ihn dabei", () => {
    const bundle = buildLogBundle([
      { name: "lgt-prod-app", text: "OPENAI_API_KEY=sk-geheimgeheimgeheim1234" },
      { name: "lgt-prod-db", text: "ready" },
    ]);
    expect(bundle).toContain("--- lgt-prod-app ---");
    expect(bundle).toContain("--- lgt-prod-db ---");
    expect(bundle).not.toContain("sk-geheimgeheimgeheim1234");
  });
});

describe("Der Auftrag an die KI", () => {
  it("AC: nennt Neustart nach Deploy ausdrücklich als NICHT auffällig", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/Neustart nach einem Deploy/);
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/einzelne fehlgeschlagene Anfrage/);
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/seit langem im Log/);
  });

  it("AC: verlangt ein ausdrückliches Nichts statt eines erfundenen Befunds", () => {
    expect(ANALYSIS_SYSTEM_PROMPT).toMatch(/Erfinde NIEMALS einen Befund/);
  });

  it("trägt den App-Namen, den Ausfall und die Logs", () => {
    const prompt = buildAnalysisPrompt("LivingGardenTwin", "--- app ---\nboom", {
      failure: "Container fehlgeschlagen",
    });
    expect(prompt).toContain("App: LivingGardenTwin");
    expect(prompt).toContain("Container fehlgeschlagen");
    expect(prompt).toContain("boom");
  });
});

describe("buildAnalysisRequest — der Aufruf beim Anbieter der App", () => {
  it("openai: Schlüssel der App im Authorization-Header", () => {
    const req = buildAnalysisRequest("openai", "sk-der-app", "gpt-4o-mini", "frag");
    expect(req?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(
      (req?.init.headers as Record<string, string>).Authorization,
    ).toBe("Bearer sk-der-app");
    expect(String(req?.init.body)).toContain("gpt-4o-mini");
  });

  it("anthropic: Schlüssel der App im x-api-key-Header", () => {
    const req = buildAnalysisRequest("anthropic", "sk-ant-app", "claude-opus-5", "frag");
    expect(req?.url).toBe("https://api.anthropic.com/v1/messages");
    const headers = req?.init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("sk-ant-app");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
  });

  it("rät nicht: ein unbekannter Anbieter ergibt keinen Aufruf", () => {
    expect(buildAnalysisRequest("mistral", "k", "m", "frag")).toBeNull();
  });

  it("kennt für beide Anbieter ein Vorgabemodell", () => {
    expect(DEFAULT_ANALYSIS_MODELS.openai).toBeTruthy();
    expect(DEFAULT_ANALYSIS_MODELS.anthropic).toBeTruthy();
  });
});

describe("extractReplyText", () => {
  it("holt den Text aus der Antwort von openai", () => {
    expect(
      extractReplyText("openai", { choices: [{ message: { content: "hallo" } }] }),
    ).toBe("hallo");
  });

  it("holt den Textblock aus der Antwort von anthropic, auch neben anderen Blöcken", () => {
    expect(
      extractReplyText("anthropic", {
        content: [{ type: "thinking", thinking: "" }, { type: "text", text: "hallo" }],
      }),
    ).toBe("hallo");
  });

  it("gibt null zurück, wenn nichts Verwertbares drinsteht", () => {
    expect(extractReplyText("openai", { choices: [] })).toBeNull();
    expect(extractReplyText("anthropic", null)).toBeNull();
  });
});

describe("parseAnalysisReply", () => {
  it("liest einen Befund samt Zusammenfassung", () => {
    const parsed = parseAnalysisReply(
      '{"befund": true, "zusammenfassung": "Der Container startet alle 20 Sekunden neu."}',
    );
    expect(parsed).toEqual({
      finding: true,
      summary: "Der Container startet alle 20 Sekunden neu.",
    });
  });

  it("versteht die Antwort auch im Codeblock oder mit Vorrede", () => {
    const parsed = parseAnalysisReply(
      'Hier mein Ergebnis:\n```json\n{"befund": false, "zusammenfassung": "nichts"}\n```',
    );
    expect(parsed?.finding).toBe(false);
  });

  it("eine nicht deutbare Antwort ist ein Fehlschlag, KEINE Entwarnung", () => {
    expect(parseAnalysisReply("Ich habe leider nichts erhalten.")).toBeNull();
    expect(parseAnalysisReply("")).toBeNull();
    expect(parseAnalysisReply(null)).toBeNull();
    expect(parseAnalysisReply('{"zusammenfassung": "irgendwas"}')).toBeNull();
  });

  it("ein Befund ohne Text ist unbrauchbar", () => {
    expect(parseAnalysisReply('{"befund": true, "zusammenfassung": ""}')).toBeNull();
  });
});

describe("analysisIsDue", () => {
  const now = new Date("2026-08-29T12:00:00.000Z");
  const at = (iso: string) =>
    ({ repoId: "r1", at: iso, trigger: "scheduled", status: "clear", summary: NO_FINDING_TEXT }) as const;

  it("ohne bisherige Analyse ist sie fällig", () => {
    expect(analysisIsDue(undefined, 24, now)).toBe(true);
  });

  it("AC: bei wöchentlichem Abstand läuft sie vor Ablauf der Woche NICHT", () => {
    const twoDaysAgo = at("2026-08-27T12:00:00.000Z");
    expect(analysisIsDue(twoDaysAgo, 24 * 7, now)).toBe(false);
    expect(analysisIsDue(twoDaysAgo, 24, now)).toBe(true);
  });

  it("ein Fehlschlag zählt wie ein Lauf — sonst liefe jede Runde in denselben Fehler", () => {
    const failed = {
      repoId: "r1",
      at: "2026-08-29T11:00:00.000Z",
      trigger: "scheduled" as const,
      status: "error" as const,
      summary: "Anbieter antwortet nicht",
    };
    expect(analysisIsDue(failed, 24, now)).toBe(false);
  });
});

describe("normalizeAnalyses", () => {
  it("übernimmt einen gespeicherten Stand", () => {
    const state = normalizeAnalyses({
      r1: {
        repoId: "r1",
        at: "2026-08-29T10:00:00.000Z",
        trigger: "manual",
        status: "finding",
        summary: "Speicher voll",
      },
    });
    expect(state.r1.trigger).toBe("manual");
    expect(state.r1.status).toBe("finding");
  });

  it("wirft Unsinn weg, statt eine erfundene Analyse zu zeigen", () => {
    expect(normalizeAnalyses(null)).toEqual({});
    expect(normalizeAnalyses({ r1: null })).toEqual({});
    expect(normalizeAnalyses({ r1: { summary: "ohne Zeitpunkt" } })).toEqual({});
  });

  it("ein unbekannter Ausgang gilt als Fehlschlag, nicht als Entwarnung", () => {
    const state = normalizeAnalyses({
      r1: { at: "2026-08-29T10:00:00.000Z", status: "quatsch", summary: "x" },
    });
    expect(state.r1.status).toBe("error");
    expect(state.r1.repoId).toBe("r1");
  });
});
