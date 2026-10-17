import { describe, it, expect } from "vitest";
import { buildContainerOverview, parseProjectEnv } from "./container-overview";
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
