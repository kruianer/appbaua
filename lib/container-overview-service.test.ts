import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import type { DockerClient } from "./docker";
import type { DockerContainer } from "./health";
import type { Repo } from "./repos";
import { readContainerOverview } from "./container-overview-service";

// req-042 an der Naht zwischen Repo-Liste und Docker: welche Gruppen die
// Container-Übersicht aus den beiden zusammensetzt.

function repo(over: Partial<Repo> = {}): Repo {
  return {
    id: "r1",
    name: "appbaua",
    url: "github.com/kruianer/appbaua",
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
    project: "appbaua-prod",
    ...over,
  };
}

function dockerStub(containers: DockerContainer[]): DockerClient {
  return {
    async list() {
      return containers;
    },
    async env() {
      return null;
    },
    async exec() {
      return { exitCode: 0, output: "" };
    },
    async logs() {
      return "";
    },
    async restart() {
      /* nicht Teil dieses Tests */
    },
  };
}

beforeEach(() => {
  setStore(createMemoryStore([repo()]));
});

describe("readContainerOverview", () => {
  it("AC: zeigt die Gruppe 'appbaua · prod' mit ihren Containern", async () => {
    const docker = dockerStub([
      container("appbaua-prod-app-1"),
      container("appbaua-prod-worker-1"),
    ]);
    const { groups } = await readContainerOverview({ docker });
    const prod = groups.find((g) => g.label === "appbaua · prod");
    expect(prod?.containers.map((c) => c.name)).toEqual(
      expect.arrayContaining(["appbaua-prod-app-1", "appbaua-prod-worker-1"]),
    );
  });

  it("AC: ein unbekannter Container steht unter 'Sonstige'", async () => {
    const docker = dockerStub([
      container("appbaua-prod-app-1"),
      container("fremder-cronjob", { project: "" }),
    ]);
    const { groups } = await readContainerOverview({ docker });
    expect(groups.at(-1)).toMatchObject({ key: "sonstige" });
    expect(groups.at(-1)!.containers.map((c) => c.name)).toEqual(["fremder-cronjob"]);
  });
});
