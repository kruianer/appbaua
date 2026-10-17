import { describe, it, expect } from "vitest";
import {
  buildContainerOverview,
  containerSince,
  containerStateLabel,
  cpuPercentFromSamples,
  formatCpuPercent,
  formatMemory,
  parseProjectEnv,
} from "./container-overview";
import type { DockerContainer } from "./health";
import type { Repo } from "./repos";

// Gruppierung der Container-Übersicht (req-042): nach App und Umgebung,
// Unbekanntes am Ende unter "Sonstige".

function repo(id: string, name: string): Repo {
  return { id, name, url: `github.com/kruianer/${name.toLowerCase()}`, active: true, model: "sonnet", monitored: true };
}

function container(
  id: string,
  name: string,
  project: string,
  state = "running",
): DockerContainer {
  return { id, name, state, status: "Up 3 hours", project };
}

describe("parseProjectEnv", () => {
  it("liest App und Umgebung aus dem Compose-Projektnamen", () => {
    expect(parseProjectEnv("appbaua-prod")).toEqual({ app: "appbaua", env: "prod" });
    expect(parseProjectEnv("appbaua-dev")).toEqual({ app: "appbaua", env: "dev" });
  });

  it("kennt nur dev und prod — alles andere ist kein Treffer", () => {
    expect(parseProjectEnv("appbaua-staging")).toBeNull();
    expect(parseProjectEnv("appbaua")).toBeNull();
    expect(parseProjectEnv("")).toBeNull();
  });
});

describe("buildContainerOverview", () => {
  const repos = [repo("r1", "appbaua"), repo("r2", "LivingGardenTwin")];

  it("AC: gruppiert appbaua-prod zu einer Gruppe 'appbaua · prod'", () => {
    const containers = [
      container("1", "appbaua-prod-app-1", "appbaua-prod"),
      container("2", "appbaua-prod-worker-1", "appbaua-prod"),
    ];
    const { groups } = buildContainerOverview(repos, containers, new Map());
    const prod = groups.find((g) => g.label === "appbaua · prod");
    expect(prod).toBeDefined();
    expect(prod!.containers.map((c) => c.name)).toEqual(
      expect.arrayContaining(["appbaua-prod-app-1", "appbaua-prod-worker-1"]),
    );
  });

  it("trennt dev und prod derselben App in zwei Gruppen", () => {
    const containers = [
      container("1", "appbaua-dev-app-1", "appbaua-dev"),
      container("2", "appbaua-prod-app-1", "appbaua-prod"),
    ];
    const { groups } = buildContainerOverview(repos, containers, new Map());
    expect(groups.map((g) => g.label)).toEqual(["appbaua · dev", "appbaua · prod"]);
  });

  it("matcht eine andere App über ihr Namenskürzel (lgt)", () => {
    const containers = [container("1", "lgt-prod-app-1", "lgt-prod")];
    const { groups } = buildContainerOverview(repos, containers, new Map());
    expect(groups.map((g) => g.label)).toEqual(["LivingGardenTwin · prod"]);
  });

  it("AC: ein Container ohne eingetragene App steht in 'Sonstige', am Ende", () => {
    const containers = [
      container("1", "appbaua-prod-app-1", "appbaua-prod"),
      container("2", "irgendein-cronjob", ""),
    ];
    const { groups } = buildContainerOverview(repos, containers, new Map());
    expect(groups[groups.length - 1]).toMatchObject({
      key: "sonstige",
      label: "Sonstige",
    });
    expect(groups[groups.length - 1].containers.map((c) => c.name)).toEqual([
      "irgendein-cronjob",
    ]);
  });

  it("ohne unbekannten Container bleibt 'Sonstige' weg", () => {
    const containers = [container("1", "appbaua-prod-app-1", "appbaua-prod")];
    const { groups } = buildContainerOverview(repos, containers, new Map());
    expect(groups.some((g) => g.key === "sonstige")).toBe(false);
  });
});

describe("cpuPercentFromSamples — Constraint: zwei Momentaufnahmen, nicht eine", () => {
  it("errechnet den Anteil der genutzten System-Zeit", () => {
    const prev = { cpuTotalUsage: 1_000_000_000, cpuSystemUsage: 10_000_000_000, onlineCpus: 2 };
    const curr = { cpuTotalUsage: 1_200_000_000, cpuSystemUsage: 11_000_000_000, onlineCpus: 2 };
    // (200_000_000 / 1_000_000_000) * 2 * 100 = 40
    expect(cpuPercentFromSamples(prev, curr)).toBeCloseTo(40, 5);
  });

  it("liefert 0 statt eines negativen oder unsinnigen Werts", () => {
    const prev = { cpuTotalUsage: 500, cpuSystemUsage: 1000, onlineCpus: 1 };
    const curr = { cpuTotalUsage: 500, cpuSystemUsage: 1000, onlineCpus: 1 };
    expect(cpuPercentFromSamples(prev, curr)).toBe(0);
  });
});

describe("formatMemory / formatCpuPercent", () => {
  it("zeigt den Speicher als Zahl mit Einheit", () => {
    expect(formatMemory(412 * 1024 * 1024)).toBe("412 MB");
  });

  it("zeigt die CPU-Last in Prozent", () => {
    expect(formatCpuPercent(3.2)).toBe("3.2 %");
  });
});

describe("containerStateLabel / containerSince", () => {
  it("AC: läuft, beendet, startet neu", () => {
    expect(containerStateLabel("running")).toBe("läuft");
    expect(containerStateLabel("exited")).toBe("beendet");
    expect(containerStateLabel("restarting")).toBe("startet neu");
  });

  it("AC: 'läuft · seit 3 Stunden' aus Docker's Status-Zeile", () => {
    expect(containerSince("Up 3 hours")).toBe("seit 3 Stunden");
    expect(containerSince("Exited (0) 2 hours ago")).toBe("seit 2 Stunden");
    expect(containerSince("Restarting (1) 5 seconds ago")).toBe("seit 5 Sekunden");
  });

  it("ohne erkennbare Dauer gibt es kein 'seit'", () => {
    expect(containerSince("Created")).toBeNull();
  });
});
