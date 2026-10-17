import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContainerOverview } from "./ContainerOverview";
import type { ContainerGroup } from "@/lib/container-overview";

// Die Container-Übersicht aus Sicht des Nutzers (req-042): welche Gruppen und
// Container auf der Seite stehen.

const PROD_GROUP: ContainerGroup = {
  key: "r1-prod",
  label: "appbaua · prod",
  memoryBytesTotal: 0,
  containers: [
    {
      id: "a",
      name: "appbaua-prod-app-1",
      state: "running",
      status: "Up 3 hours",
      memoryBytes: null,
      cpuPercent: null,
    },
    {
      id: "w",
      name: "appbaua-prod-worker-1",
      state: "running",
      status: "Up 3 hours",
      memoryBytes: null,
      cpuPercent: null,
    },
  ],
};

const SONSTIGE_GROUP: ContainerGroup = {
  key: "sonstige",
  label: "Sonstige",
  memoryBytesTotal: 0,
  containers: [
    {
      id: "c",
      name: "fremder-cronjob",
      state: "running",
      status: "Up 1 hour",
      memoryBytes: null,
      cpuPercent: null,
    },
  ],
};

let groups: ContainerGroup[];

beforeEach(() => {
  groups = [PROD_GROUP, SONSTIGE_GROUP];
  vi.stubGlobal("fetch", async () => ({
    ok: true,
    json: async () => ({ groups }),
  }));
});

describe("Container-Übersicht (req-042)", () => {
  it("AC: zeigt die Gruppe 'appbaua · prod'", async () => {
    render(<ContainerOverview />);
    expect(await screen.findByText("appbaua · prod")).toBeInTheDocument();
  });

  it("AC: appbaua-prod-app-1 und appbaua-prod-worker-1 stehen in der Gruppe", async () => {
    render(<ContainerOverview />);
    await screen.findByText("appbaua · prod");
    expect(screen.getByText("appbaua-prod-app-1")).toBeInTheDocument();
    expect(screen.getByText("appbaua-prod-worker-1")).toBeInTheDocument();
  });

  it("AC: ein Container ohne eingetragene App steht unter 'Sonstige'", async () => {
    render(<ContainerOverview />);
    await screen.findByText("Sonstige");
    expect(screen.getByText("fremder-cronjob")).toBeInTheDocument();
  });
});
