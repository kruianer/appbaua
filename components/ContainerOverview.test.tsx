import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ContainerOverview } from "./ContainerOverview";
import type { ContainerGroup } from "@/lib/container-overview";

// Die Container-Übersicht aus Sicht des Nutzers (req-042): welche Gruppen und
// Container auf der Seite stehen.

const PROD_GROUP: ContainerGroup = {
  key: "r1-prod",
  label: "appbaua · prod",
  memoryBytesTotal: 412 * 1024 * 1024,
  containers: [
    {
      id: "a",
      name: "appbaua-prod-app-1",
      state: "running",
      status: "Up 3 hours",
      memoryBytes: 412 * 1024 * 1024,
      cpuPercent: 3.2,
    },
    {
      id: "w",
      name: "appbaua-prod-worker-1",
      state: "exited",
      status: "Exited (0) 2 hours ago",
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

  it("AC: ein laufender Container zeigt Speicher als Zahl mit Einheit", async () => {
    render(<ContainerOverview />);
    expect((await screen.findAllByText("412 MB")).length).toBeGreaterThan(0);
  });

  it("AC: ein laufender Container zeigt die CPU-Last in Prozent", async () => {
    render(<ContainerOverview />);
    expect(await screen.findByText("3.2 %")).toBeInTheDocument();
  });

  it("AC: Zustand und seit wann stehen beim laufenden Container", async () => {
    render(<ContainerOverview />);
    expect(await screen.findByText("läuft · seit 3 Stunden")).toBeInTheDocument();
  });

  it("AC: die Gruppenüberschrift zeigt die Summe des Speichers der Gruppe", async () => {
    render(<ContainerOverview />);
    await screen.findByText("appbaua · prod");
    expect(screen.getAllByText("412 MB").length).toBe(2);
  });

  it("AC: ein beendeter Container ist als beendet erkennbar und zeigt keine CPU-Last", async () => {
    render(<ContainerOverview />);
    expect(await screen.findByText(/beendet/)).toBeInTheDocument();
    // Nur der laufende Container (appbaua-prod-app-1) zeigt eine CPU-Last.
    expect(screen.getAllByText(/%$/)).toHaveLength(1);
  });
});
