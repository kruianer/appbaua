import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import { createMemoryHealthStore, setHealthStore } from "./health-store";
import { createMemoryRunLogStore, setRunLogStore } from "./run-log-store";
import type { RunLogStore } from "./run-log-store";
import type { DockerClient } from "./docker";
import type { DockerContainer } from "./health";
import type { Repo } from "./repos";
import { NO_FINDING_TEXT } from "./log-analysis";
import {
  ANALYSIS_LOG_LABEL,
  analyzeOnFailure,
  analyzeRepoLogs,
  runDueAnalyses,
} from "./log-analysis-service";
import { readHealthOverview, updateHealthSettings } from "./health-service";

// req-035 an der Naht: was wirklich an die KI geht, was auf der Karte landet
// und was passiert, wenn die Analyse abgeschaltet ist oder scheitert.

const NOW = new Date("2026-08-29T12:00:00.000Z");

const HEALTH_MD = `
# Gesundheit

## KI-Anbieter
- Anbieter: openai
- Schluessel aus: \`OPENAI_API_KEY\`
`;

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: "r1",
    name: "LivingGardenTwin",
    url: "github.com/kruianer/livinggardentwin",
    active: true,
    model: "sonnet",
    monitored: true,
    ...over,
  };
}

function container(name: string): DockerContainer {
  return { id: name, name, state: "running", status: "Up 3 hours", project: "lgt-prod" };
}

function dockerStub(logs: Record<string, string>) {
  const asked: { id: string; tail: number }[] = [];
  const client: DockerClient = {
    async list() {
      return Object.keys(logs).map(container);
    },
    async env(_id, name) {
      return name === "OPENAI_API_KEY" ? "sk-der-app-geheim-1234567890" : null;
    },
    async exec() {
      return { exitCode: 0, output: "" };
    },
    async logs(id, tail) {
      asked.push({ id, tail });
      return logs[id] ?? "";
    },
    async restart() {},
  };
  return { client, asked };
}

/** Ein Anbieter, der antwortet wie gewünscht — und merkt sich, was er bekam. */
function aiStub(reply: string | { status: number }) {
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), body: String(init?.body ?? "") });
    if (typeof reply !== "string") {
      return { ok: false, status: reply.status, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: reply } }] }),
    };
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

function deps(over: Partial<Parameters<typeof analyzeRepoLogs>[2]> = {}) {
  return {
    readHealthMd: async () => HEALTH_MD,
    now: () => NOW,
    ...over,
  };
}

let runLog: RunLogStore;

beforeEach(() => {
  setStore(createMemoryStore([repo()]));
  setHealthStore(createMemoryHealthStore());
  runLog = createMemoryRunLogStore();
  setRunLogStore(runLog);
});

describe("analyzeRepoLogs — was an die KI geht", () => {
  it("schickt die bereinigten Logs der Container DIESER App", async () => {
    const docker = dockerStub({
      "lgt-prod-app": "startup ok\nDB_PASSWORD=hunter2\nrequest from 93.184.216.34",
    });
    const ai = aiStub('{"befund": false, "zusammenfassung": "alles normal"}');

    await analyzeRepoLogs(
      "r1",
      "scheduled",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );

    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0].url).toContain("openai.com");
    expect(ai.calls[0].body).toContain("startup ok");
    // AC-Constraint: Zugangsdaten und personenbezogene Daten gehen NICHT mit.
    expect(ai.calls[0].body).not.toContain("hunter2");
    expect(ai.calls[0].body).not.toContain("93.184.216.34");
    // Und die Menge ist begrenzt.
    expect(docker.asked[0].tail).toBeLessThanOrEqual(200);
  });

  it("benutzt den Schlüssel der App, nicht den von appbaua", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push(String((init?.headers as Record<string, string>).Authorization));
      return ai.fetchImpl(url as unknown as string, init);
    }) as unknown as typeof fetch;

    await analyzeRepoLogs("r1", "manual", deps({ docker: docker.client, fetchImpl }));
    expect(calls).toEqual(["Bearer sk-der-app-geheim-1234567890"]);
  });

  it("AC: ohne Auffälligkeit steht 'keine Auffälligkeiten' da — kein erfundener Befund", async () => {
    const docker = dockerStub({ "lgt-prod-app": "alles ruhig" });
    // Das Modell schreibt trotzdem Prosa dazu — sie darf nicht wie ein Befund
    // auf der Karte landen.
    const ai = aiStub(
      '{"befund": false, "zusammenfassung": "Vielleicht könnte man mal aufräumen."}',
    );

    const analysis = await analyzeRepoLogs(
      "r1",
      "scheduled",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );

    expect(analysis?.status).toBe("clear");
    expect(analysis?.summary).toBe(NO_FINDING_TEXT);
    expect(analysis?.at).toBe(NOW.toISOString());

    const { apps } = await readHealthOverview();
    expect(apps[0].analysis?.summary).toBe(NO_FINDING_TEXT);
    expect(apps[0].analysis?.at).toBe(NOW.toISOString());
  });

  it("AC: ein Befund steht mit Zeitpunkt auf der Karte", async () => {
    const docker = dockerStub({ "lgt-prod-app": "OOMKilled" });
    const ai = aiStub(
      '{"befund": true, "zusammenfassung": "Der Container wird wegen Speichermangels getötet."}',
    );

    await analyzeRepoLogs(
      "r1",
      "manual",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );

    const { apps } = await readHealthOverview();
    expect(apps[0].analysis).toMatchObject({
      status: "finding",
      trigger: "manual",
      summary: "Der Container wird wegen Speichermangels getötet.",
    });
  });

  it("AC: jede Analyse steht mit App, Zeitpunkt und Ergebnis im Verlauf", async () => {
    const docker = dockerStub({ "lgt-prod-app": "OOMKilled" });
    const ai = aiStub('{"befund": true, "zusammenfassung": "Speicher voll."}');

    await analyzeRepoLogs(
      "r1",
      "scheduled",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );

    const [entry] = await runLog.list(0, 10);
    expect(entry).toMatchObject({
      repo: "LivingGardenTwin",
      taskType: ANALYSIS_LOG_LABEL,
      status: "success",
      message: "Speicher voll.",
      startedAt: NOW.toISOString(),
    });
  });

  it("AC: antwortet der Anbieter nicht, steht der Fehlschlag im Verlauf — und sonst passiert nichts", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const fetchImpl = (async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;

    const analysis = await analyzeRepoLogs(
      "r1",
      "scheduled",
      deps({ docker: docker.client, fetchImpl }),
    );

    expect(analysis?.status).toBe("error");
    const [entry] = await runLog.list(0, 10);
    expect(entry.status).toBe("error");
    expect(entry.taskType).toBe(ANALYSIS_LOG_LABEL);
    // Die Prüfergebnisse der Überwachung bleiben davon unberührt.
    const { apps } = await readHealthOverview();
    expect(apps[0].checks.every((c) => c.status === "unknown")).toBe(true);
  });

  it("eine nicht deutbare Antwort ist ein Fehlschlag, keine Entwarnung", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub("Ich habe die Logs nicht bekommen.");

    const analysis = await analyzeRepoLogs(
      "r1",
      "scheduled",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );
    expect(analysis?.status).toBe("error");
    expect(analysis?.summary).toContain("nicht verwertbar");
  });

  it("ohne Abschnitt '## KI-Anbieter' wird gar nicht erst gefragt", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');

    const analysis = await analyzeRepoLogs("r1", "manual", {
      docker: docker.client,
      fetchImpl: ai.fetchImpl,
      readHealthMd: async () => null,
      now: () => NOW,
    });

    expect(analysis?.status).toBe("error");
    expect(ai.calls).toEqual([]);
  });

  it("ein nicht überwachtes Repo wird nicht analysiert", async () => {
    setStore(createMemoryStore([repo({ monitored: false })]));
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');

    expect(
      await analyzeRepoLogs(
        "r1",
        "manual",
        deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
      ),
    ).toBeNull();
    expect(ai.calls).toEqual([]);
  });
});

describe("runDueAnalyses — die regelmäßige Analyse", () => {
  it("läuft einmal und dann erst wieder nach dem eingestellten Abstand", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');
    const d = deps({ docker: docker.client, fetchImpl: ai.fetchImpl });

    expect(await runDueAnalyses(d)).toBe(1);
    expect(await runDueAnalyses(d)).toBe(0);
    expect(ai.calls).toHaveLength(1);
  });

  it("AC: bei wöchentlichem Abstand läuft vor Ablauf der Woche keine Analyse", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');
    await updateHealthSettings({ logAnalysisIntervalHours: 24 * 7 });

    await runDueAnalyses(deps({ docker: docker.client, fetchImpl: ai.fetchImpl }));
    const twoDaysLater = new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000);
    await runDueAnalyses(
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl, now: () => twoDaysLater }),
    );

    expect(ai.calls).toHaveLength(1);

    // ... der Knopf auf der Karte funktioniert trotzdem.
    await analyzeRepoLogs(
      "r1",
      "manual",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl, now: () => twoDaysLater }),
    );
    expect(ai.calls).toHaveLength(2);
  });

  it("AC: abgeschaltet heißt: KEIN Aufruf an die KI", async () => {
    const docker = dockerStub({ "lgt-prod-app": "hallo" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');
    await updateHealthSettings({ logAnalysis: false });

    expect(
      await runDueAnalyses(deps({ docker: docker.client, fetchImpl: ai.fetchImpl })),
    ).toBe(0);
    expect(ai.calls).toEqual([]);
    const { apps } = await readHealthOverview();
    expect(apps[0].analysis).toBeNull();
  });
});

describe("analyzeOnFailure — die Analyse zu einem gemeldeten Ausfall", () => {
  it("gibt den Befund zurück, damit er mit der Meldung hinausgeht", async () => {
    const docker = dockerStub({ "lgt-prod-app": "restarting" });
    const ai = aiStub(
      '{"befund": true, "zusammenfassung": "Die Datenbankverbindung bricht dauernd ab."}',
    );

    const summary = await analyzeOnFailure(
      "r1",
      "Container fehlgeschlagen",
      deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
    );

    expect(summary).toBe("Die Datenbankverbindung bricht dauernd ab.");
    expect(ai.calls[0].body).toContain("Container fehlgeschlagen");
    const { apps } = await readHealthOverview();
    expect(apps[0].analysis?.trigger).toBe("failure");
  });

  it("ohne Befund geht nichts mit hinaus — die Meldung bleibt wie sie war", async () => {
    const docker = dockerStub({ "lgt-prod-app": "restarting" });
    const ai = aiStub('{"befund": false, "zusammenfassung": "-"}');

    expect(
      await analyzeOnFailure(
        "r1",
        "Container fehlgeschlagen",
        deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
      ),
    ).toBeNull();
  });

  it("AC: abgeschaltet heißt bei einem Fehlschlag: KEIN Aufruf, kein Ergebnis", async () => {
    const docker = dockerStub({ "lgt-prod-app": "restarting" });
    const ai = aiStub('{"befund": true, "zusammenfassung": "irgendwas"}');
    await updateHealthSettings({ logAnalysisOnFailure: false });

    expect(
      await analyzeOnFailure(
        "r1",
        "Container fehlgeschlagen",
        deps({ docker: docker.client, fetchImpl: ai.fetchImpl }),
      ),
    ).toBeNull();
    expect(ai.calls).toEqual([]);
    const { apps } = await readHealthOverview();
    expect(apps[0].analysis).toBeNull();
  });
});
