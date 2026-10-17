import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryStore, setStore } from "./store";
import type { ContainerStatsSample, DockerClient } from "./docker";
import type { DockerContainer } from "./health";
import type { Repo } from "./repos";
import {
  measureRunningContainers,
  readContainerOverview,
  runContainerMeasurement,
} from "./container-overview-service";

// req-042 an der Naht zwischen Repo-Liste, Docker und der zweiten CPU-Messung.

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

/** Jeder Aufruf liefert die nächste vorgegebene Momentaufnahme je Container. */
function dockerStub(
  containers: DockerContainer[],
  samplesById: Record<string, ContainerStatsSample[]>,
): DockerClient {
  const calls: Record<string, number> = {};
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
    async stats(id) {
      const n = calls[id] ?? 0;
      calls[id] = n + 1;
      const series = samplesById[id];
      if (!series) throw new Error(`keine Messwerte für ${id}`);
      return series[Math.min(n, series.length - 1)];
    },
  };
}

const noWait = async () => {
  /* Tests warten nicht wirklich die Sekunde ab */
};

beforeEach(() => {
  setStore(createMemoryStore([repo()]));
});

describe("measureRunningContainers", () => {
  it("AC: errechnet Speicher und CPU aus zwei Momentaufnahmen im Abstand", async () => {
    const containers = [container("appbaua-prod-app-1")];
    const docker = dockerStub(containers, {
      "appbaua-prod-app-1": [
        { memoryBytes: 400 * 1024 * 1024, cpuTotalUsage: 1_000_000_000, cpuSystemUsage: 10_000_000_000, onlineCpus: 2 },
        { memoryBytes: 412 * 1024 * 1024, cpuTotalUsage: 1_200_000_000, cpuSystemUsage: 11_000_000_000, onlineCpus: 2 },
      ],
    });
    const stats = await measureRunningContainers(containers, { docker, wait: noWait });
    const s = stats.get("appbaua-prod-app-1");
    expect(s?.memoryBytes).toBe(412 * 1024 * 1024);
    // (200_000_000 / 1_000_000_000) * 2 * 100 = 40
    expect(s?.cpuPercent).toBeCloseTo(40, 5);
  });

  it("misst beendete Container gar nicht erst", async () => {
    const containers = [container("x", { state: "exited" })];
    const docker = dockerStub(containers, {});
    const stats = await measureRunningContainers(containers, { docker, wait: noWait });
    expect(stats.has("x")).toBe(false);
  });
});

describe("runContainerMeasurement + readContainerOverview", () => {
  it("AC: Speicher und CPU eines laufenden Containers stehen in der Übersicht", async () => {
    const containers = [container("appbaua-prod-app-1")];
    const docker = dockerStub(containers, {
      "appbaua-prod-app-1": [
        { memoryBytes: 400 * 1024 * 1024, cpuTotalUsage: 0, cpuSystemUsage: 0, onlineCpus: 1 },
        { memoryBytes: 412 * 1024 * 1024, cpuTotalUsage: 50, cpuSystemUsage: 100, onlineCpus: 1 },
      ],
    });
    expect(await runContainerMeasurement({ docker, wait: noWait })).toBe(true);

    const { groups, measuring } = await readContainerOverview();
    expect(measuring).toBe(false);
    const row = groups[0].containers[0];
    expect(row.memoryBytes).toBe(412 * 1024 * 1024);
    expect(row.cpuPercent).toBeCloseTo(50, 5);
  });

  it("AC: ein beendeter Container zeigt KEINE CPU-Last", async () => {
    const containers = [container("appbaua-prod-app-1", { state: "exited", status: "Exited (0) 2 hours ago" })];
    const docker = dockerStub(containers, {});
    expect(await runContainerMeasurement({ docker, wait: noWait })).toBe(true);

    const { groups } = await readContainerOverview();
    const row = groups[0].containers[0];
    expect(row.state).toBe("exited");
    expect(row.cpuPercent).toBeNull();
    expect(row.memoryBytes).toBeNull();
  });

  it("AC: die Gruppenüberschrift zeigt die Summe des Speichers", async () => {
    const containers = [
      container("appbaua-prod-app-1"),
      container("appbaua-prod-worker-1"),
    ];
    const docker = dockerStub(containers, {
      "appbaua-prod-app-1": [
        { memoryBytes: 100 * 1024 * 1024, cpuTotalUsage: 0, cpuSystemUsage: 0, onlineCpus: 1 },
        { memoryBytes: 100 * 1024 * 1024, cpuTotalUsage: 0, cpuSystemUsage: 0, onlineCpus: 1 },
      ],
      "appbaua-prod-worker-1": [
        { memoryBytes: 300 * 1024 * 1024, cpuTotalUsage: 0, cpuSystemUsage: 0, onlineCpus: 1 },
        { memoryBytes: 300 * 1024 * 1024, cpuTotalUsage: 0, cpuSystemUsage: 0, onlineCpus: 1 },
      ],
    });
    expect(await runContainerMeasurement({ docker, wait: noWait })).toBe(true);

    const { groups } = await readContainerOverview();
    expect(groups[0].memoryBytesTotal).toBe(400 * 1024 * 1024);
  });
});
