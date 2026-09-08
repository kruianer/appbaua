import { describe, it, expect } from "vitest";
import type { AppHealth, CheckResult, ContainerInfo } from "./health";
import type { RestartResult } from "./health-service";
import {
  type CommandDeps,
  type PendingRestart,
  findApp,
  findContainerApp,
  formatOverview,
  handleMessage,
  parseCommand,
} from "./telegram-commands";

// req-033, die Befehlsseite. Der teuerste Fehler hier wäre ein Neustart, den
// niemand bestätigt hat — er trifft echte laufende Systeme, auch prod-Umgebungen
// fremder Apps. Entsprechend viel Platz nimmt die Rückfrage unten ein.

const AT = "2026-08-29T12:00:00.000Z";

function container(name: string, failing = false): ContainerInfo {
  return { id: name, name, state: failing ? "restarting" : "running", status: "", failing };
}

function checks(over: Partial<CheckResult>[] = []): CheckResult[] {
  const base: CheckResult[] = [
    {
      kind: "container",
      status: "fail",
      detail: "lgt-prod-monitoring-watchdog (Neustart-Schleife)",
      checkedAt: AT,
      containers: [
        container("lgt-prod-app"),
        container("lgt-prod-monitoring-watchdog", true),
      ],
    },
    { kind: "web", status: "ok", detail: "dev: 307", checkedAt: AT },
  ];
  return base.map((c, i) => ({ ...c, ...over[i] }));
}

const LGT: AppHealth = {
  repoId: "r1",
  repoName: "LivingGardenTwin",
  repoUrl: "github.com/kruianer/livinggardentwin",
  lamp: "red",
  checks: checks(),
  checkedAt: AT,
};

const APPBAUA: AppHealth = {
  repoId: "r2",
  repoName: "appbaua",
  repoUrl: "github.com/kruianer/appbaua",
  lamp: "green",
  checks: [{ kind: "container", status: "ok", detail: "2 Container laufen", checkedAt: AT }],
  checkedAt: AT,
};

function deps(over: Partial<CommandDeps> = {}) {
  const restarted: string[] = [];
  const full: CommandDeps = {
    readApps: async () => [LGT, APPBAUA],
    restart: async (repoId, name): Promise<RestartResult> => {
      restarted.push(`${repoId}/${name}`);
      return { ok: true, container: name };
    },
    ...over,
  };
  return { deps: full, restarted };
}

describe("parseCommand", () => {
  it("kennt Status, Status mit App und Neustart", () => {
    expect(parseCommand("/status")).toEqual({ kind: "status", app: null });
    expect(parseCommand("/status LivingGardenTwin")).toEqual({
      kind: "status",
      app: "LivingGardenTwin",
    });
    expect(parseCommand("/neustart lgt-prod-app")).toEqual({
      kind: "restart",
      container: "lgt-prod-app",
    });
  });

  it("verträgt das @botname, das Telegram anhängt", () => {
    expect(parseCommand("/status@appbauabot")).toEqual({ kind: "status", app: null });
  });

  it("erkennt die Bestätigung", () => {
    expect(parseCommand("ja")).toEqual({ kind: "confirm" });
    expect(parseCommand("Ja")).toEqual({ kind: "confirm" });
    expect(parseCommand("/ja")).toEqual({ kind: "confirm" });
  });

  it("ein /neustart ohne Container ist kein Befehl", () => {
    expect(parseCommand("/neustart")).toEqual({ kind: "unknown" });
  });

  it("alles andere ist unbekannt — es gibt keine weiteren Befehle", () => {
    expect(parseCommand("/deploy prod")).toEqual({ kind: "unknown" });
    expect(parseCommand("hallo")).toEqual({ kind: "unknown" });
  });
});

describe("/status", () => {
  it("AC: je überwachter App eine Zeile mit ihrem Zustand", async () => {
    const { deps: d } = deps();
    const { reply } = await handleMessage("/status", null, d);

    const lines = reply.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("LivingGardenTwin");
    expect(lines[0]).toContain("gestört");
    expect(lines[1]).toContain("appbaua");
    expect(lines[1]).toContain("läuft");
  });

  it("ohne überwachte App sagt es das", () => {
    expect(formatOverview([])).toContain("Keine App wird überwacht");
  });

  it("/status <app> zeigt die einzelnen Prüfungen", async () => {
    const { deps: d } = deps();
    const { reply } = await handleMessage("/status LivingGardenTwin", null, d);

    expect(reply).toContain("Container");
    expect(reply).toContain("lgt-prod-monitoring-watchdog (Neustart-Schleife)");
    expect(reply).toContain("Web");
    expect(reply).toContain("dev: 307");
  });

  it("eine unbekannte App führt zur Übersicht statt ins Leere", async () => {
    const { deps: d } = deps();
    const { reply } = await handleMessage("/status Nixgibts", null, d);
    expect(reply).toContain("Keine überwachte App");
    expect(reply).toContain("LivingGardenTwin");
  });

  it("findApp nimmt den eindeutigen Anfang, aber nicht das Mehrdeutige", () => {
    expect(findApp([LGT, APPBAUA], "living")?.repoId).toBe("r1");
    expect(findApp([LGT, APPBAUA], "livinggardentwin")?.repoId).toBe("r1");
    expect(findApp([LGT, { ...APPBAUA, repoName: "LivingRoom" }], "living")).toBeNull();
  });
});

describe("/neustart — erst die Rückfrage, dann der Neustart", () => {
  it("AC: der Bot fragt zuerst nach und startet noch nichts", async () => {
    const { deps: d, restarted } = deps();
    const { reply, pending } = await handleMessage(
      "/neustart lgt-prod-monitoring-watchdog",
      null,
      d,
    );

    expect(restarted).toEqual([]);
    expect(reply).toContain("wirklich neu gestartet");
    expect(reply).toContain("lgt-prod-monitoring-watchdog");
    expect(pending).toEqual({
      repoId: "r1",
      repoName: "LivingGardenTwin",
      container: "lgt-prod-monitoring-watchdog",
    });
  });

  it("AC: erst nach der Bestätigung wird der Container neu gestartet", async () => {
    const { deps: d, restarted } = deps();
    const asked = await handleMessage("/neustart lgt-prod-monitoring-watchdog", null, d);
    const done = await handleMessage("ja", asked.pending, d);

    expect(restarted).toEqual(["r1/lgt-prod-monitoring-watchdog"]);
    expect(done.reply).toContain("wird neu gestartet");
    expect(done.pending).toBeNull();
  });

  it("AC: wer stattdessen etwas anderes schreibt, startet NICHTS neu", async () => {
    const { deps: d, restarted } = deps();
    const asked = await handleMessage("/neustart lgt-prod-monitoring-watchdog", null, d);
    const other = await handleMessage("/status", asked.pending, d);

    expect(restarted).toEqual([]);
    expect(other.reply).toContain("Abgebrochen");
    expect(other.pending).toBeNull();
    // Die Nachricht selbst wird trotzdem als Befehl gelesen.
    expect(other.reply).toContain("LivingGardenTwin");
  });

  it("eine spätere Bestätigung läuft ins Leere, statt den alten Wunsch nachzuholen", async () => {
    const { deps: d, restarted } = deps();
    const asked = await handleMessage("/neustart lgt-prod-monitoring-watchdog", null, d);
    const cancelled = await handleMessage("nein", asked.pending, d);
    const late = await handleMessage("ja", cancelled.pending, d);

    expect(restarted).toEqual([]);
    expect(late.reply).toContain("keine Rückfrage");
  });

  it("ein Container, den keine überwachte App kennt, wird abgewiesen", async () => {
    const { deps: d, restarted } = deps();
    const res = await handleMessage("/neustart fremder-container", null, d);

    expect(restarted).toEqual([]);
    expect(res.pending).toBeNull();
    expect(res.reply).toContain("gehört zu keiner überwachten App");
  });

  it("ein gescheiterter Neustart wird gemeldet, nicht verschwiegen", async () => {
    const { deps: d } = deps({
      restart: async () => ({ ok: false, error: "Docker nicht erreichbar." }),
    });
    const asked = await handleMessage("/neustart lgt-prod-app", null, d);
    const done = await handleMessage("ja", asked.pending, d);

    expect(done.reply).toContain("Docker nicht erreichbar.");
    expect(done.pending).toBeNull();
  });

  it("die Schreibweise aus der Prüfung gewinnt", async () => {
    const { deps: d, restarted } = deps();
    const asked = await handleMessage("/neustart LGT-PROD-APP", null, d);
    await handleMessage("ja", asked.pending as PendingRestart, d);
    expect(restarted).toEqual(["r1/lgt-prod-app"]);
  });

  it("findContainerApp findet den Besitzer eines Containers", () => {
    expect(findContainerApp([LGT, APPBAUA], "lgt-prod-app")?.repoId).toBe("r1");
    expect(findContainerApp([LGT, APPBAUA], "gibtsnicht")).toBeNull();
  });
});

describe("unbekannte Nachrichten", () => {
  it("bekommen die kurze Liste dessen, was es gibt", async () => {
    const { deps: d } = deps();
    const { reply } = await handleMessage("/deploy prod", null, d);
    expect(reply).toContain("/status");
    expect(reply).toContain("/neustart");
    expect(reply).not.toContain("/deploy");
  });
});
