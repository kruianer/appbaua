import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import { createMemoryHealthStore, setHealthStore } from "./health-store";
import type { DockerClient } from "./docker";
import type { AppHealth, DockerContainer } from "./health";
import type { Repo } from "./repos";
import {
  readHealthOverview,
  restartAppContainer,
  runDueChecks,
  updateHealthSettings,
} from "./health-service";

// req-032 an der Naht zwischen Repo-Liste, Speicher und Prüfungen: welche
// Karten die Seite zeigt, was auf einer Karte ohne Ergebnis steht, und was ein
// Klick auf "Neu starten" wirklich anfasst.

const NOW = new Date("2026-08-29T12:00:00.000Z");

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

function container(name: string, over: Partial<DockerContainer> = {}): DockerContainer {
  return {
    id: name,
    name,
    state: "running",
    status: "Up 3 hours",
    project: "lgt-prod",
    ...over,
  };
}

function dockerStub(containers: DockerContainer[]) {
  const restarts: string[] = [];
  const client: DockerClient = {
    async list() {
      return containers;
    },
    async env() {
      return null;
    },
    async exec() {
      return { exitCode: 0, output: "" };
    },
    async restart(id) {
      restarts.push(id);
    },
  };
  return { client, restarts };
}

beforeEach(() => {
  setHealthStore(createMemoryHealthStore());
});

describe("readHealthOverview — welche Karten die Seite zeigt", () => {
  it("AC: ein Repo mit ausgeschaltetem Schalter bekommt KEINE Karte", async () => {
    setStore(
      createMemoryStore([
        repo({ id: "r1", name: "LivingGardenTwin", monitored: false }),
        repo({ id: "r2", name: "appbaua", url: "github.com/kruianer/appbaua" }),
      ]),
    );
    const { apps } = await readHealthOverview();
    expect(apps.map((a) => a.repoName)).toEqual(["appbaua"]);
  });

  it("AC: für den Worker deaktiviert, aber überwacht — die Karte ist trotzdem da", async () => {
    setStore(createMemoryStore([repo({ active: false, monitored: true })]));
    const { apps } = await readHealthOverview();
    expect(apps.map((a) => a.repoName)).toEqual(["LivingGardenTwin"]);
  });

  it("AC: ohne Prüfergebnis steht 'noch nicht geprüft' da, keine leere Seite", async () => {
    setStore(createMemoryStore([repo()]));
    const { apps } = await readHealthOverview();
    expect(apps).toHaveLength(1);
    expect(apps[0].lamp).toBe("unknown");
    expect(apps[0].checkedAt).toBeNull();
    expect(apps[0].checks.every((c) => c.detail === "noch nicht geprüft")).toBe(true);
  });

  it("zeigt den aktuellen Repo-Namen, auch wenn das Ergebnis den alten trägt", async () => {
    const stored: AppHealth = {
      repoId: "r1",
      repoName: "AlterName",
      repoUrl: "alt",
      lamp: "green",
      checks: [{ kind: "container", status: "ok", detail: "1 Container läuft", checkedAt: NOW.toISOString() }],
      checkedAt: NOW.toISOString(),
    };
    setStore(createMemoryStore([repo()]));
    setHealthStore(createMemoryHealthStore({ results: [stored] }));
    const { apps } = await readHealthOverview();
    expect(apps[0].repoName).toBe("LivingGardenTwin");
    expect(apps[0].lamp).toBe("green");
  });

  it("liefert die Einstellungen mit — Vorgabe 5 Minuten und 24 Stunden", async () => {
    setStore(createMemoryStore([]));
    const { settings } = await readHealthOverview();
    expect(settings.intervalMinutes).toBe(5);
    expect(settings.aiIntervalHours).toBe(24);
  });
});

describe("runDueChecks", () => {
  it("prüft nur überwachte Repos und legt das Ergebnis ab", async () => {
    setStore(
      createMemoryStore([repo(), repo({ id: "r2", name: "appbaua", monitored: false })]),
    );
    const { client } = dockerStub([container("lgt-prod-app")]);

    const ran = await runDueChecks({
      docker: client,
      readHealthMd: async () => null,
      now: () => NOW,
    });

    expect(ran).toBe(true);
    const { apps } = await readHealthOverview();
    expect(apps.map((a) => a.repoName)).toEqual(["LivingGardenTwin"]);
    expect(apps[0].lamp).toBe("green");
  });

  it("tut nichts, solange nichts fällig ist", async () => {
    setStore(createMemoryStore([repo()]));
    const { client } = dockerStub([container("lgt-prod-app")]);
    const deps = { docker: client, readHealthMd: async () => null, now: () => NOW };

    expect(await runDueChecks(deps)).toBe(true);
    expect(await runDueChecks(deps)).toBe(false);
  });

  it("eine abgeschaltete Prüfart wird auch beim ersten Lauf nicht ausgeführt", async () => {
    setStore(createMemoryStore([repo()]));
    await updateHealthSettings({ checks: { container: false } });
    const { client } = dockerStub([container("lgt-prod-app")]);

    await runDueChecks({ docker: client, readHealthMd: async () => null, now: () => NOW });
    const { apps } = await readHealthOverview();
    expect(apps[0].checks.find((c) => c.kind === "container")?.status).toBe("off");
  });
});

describe("restartAppContainer — nur auf Klick, und nur der eine", () => {
  it("AC: genau dieser Container wird neu gestartet, die übrigen bleiben unberührt", async () => {
    setStore(createMemoryStore([repo()]));
    const { client, restarts } = dockerStub([
      container("lgt-prod-app"),
      container("lgt-prod-db"),
      container("lgt-prod-monitoring-watchdog", { state: "restarting" }),
    ]);

    const res = await restartAppContainer("r1", "lgt-prod-monitoring-watchdog", {
      docker: client,
      readHealthMd: async () => null,
    });

    expect(res).toEqual({ ok: true, container: "lgt-prod-monitoring-watchdog" });
    expect(restarts).toEqual(["lgt-prod-monitoring-watchdog"]);
  });

  it("ein Container, der nicht zu dieser App gehört, wird abgewiesen", async () => {
    setStore(createMemoryStore([repo()]));
    const { client, restarts } = dockerStub([
      container("lgt-prod-app"),
      container("appbaua-prod-db", { project: "appbaua-prod" }),
    ]);

    const res = await restartAppContainer("r1", "appbaua-prod-db", {
      docker: client,
      readHealthMd: async () => null,
    });

    expect(res.ok).toBe(false);
    expect(restarts).toEqual([]);
  });

  it("ein nicht überwachtes Repo darf gar nichts neu starten", async () => {
    setStore(createMemoryStore([repo({ monitored: false })]));
    const { client, restarts } = dockerStub([container("lgt-prod-app")]);

    const res = await restartAppContainer("r1", "lgt-prod-app", {
      docker: client,
      readHealthMd: async () => null,
    });

    expect(res.ok).toBe(false);
    expect(restarts).toEqual([]);
  });

  it("ohne Docker sagt es das, statt still zu scheitern", async () => {
    setStore(createMemoryStore([repo()]));
    const { client } = dockerStub([]);
    client.list = async () => {
      throw new Error("kein Socket");
    };
    const res = await restartAppContainer("r1", "lgt-prod-app", {
      docker: client,
      readHealthMd: async () => null,
    });
    expect(res).toEqual({ ok: false, error: "Docker nicht erreichbar." });
  });
});

describe("updateHealthSettings", () => {
  it("übernimmt Abstände und Schalter", async () => {
    const saved = await updateHealthSettings({
      intervalMinutes: 10,
      aiIntervalHours: 6,
      checks: { ai: false },
    });
    expect(saved.intervalMinutes).toBe(10);
    expect(saved.aiIntervalHours).toBe(6);
    expect(saved.checks.ai).toBe(false);
    expect(saved.checks.container).toBe(true);
    expect((await readHealthOverview()).settings.checks.ai).toBe(false);
  });
});
