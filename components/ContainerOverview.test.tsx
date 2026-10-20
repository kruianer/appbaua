import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
let restartCalls: { id: string }[];

beforeEach(() => {
  groups = [PROD_GROUP, SONSTIGE_GROUP];
  restartCalls = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/health/containers/restart" && init?.method === "POST") {
      restartCalls.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ container: "appbaua-prod-app-1" }) };
    }
    return { ok: true, json: async () => ({ groups }) };
  });
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

  it("AC (bug-027): die Gruppenkarte zeigt Speicher- UND CPU-Summe der Gruppe", async () => {
    const { container } = render(<ContainerOverview />);
    await screen.findByText("appbaua · prod");
    const summary = container.querySelector('[data-group-key="r1-prod"] [data-group-summary]')!;
    expect(summary.textContent).toMatch(/412 MB.*3\.2 %/);
  });

  it("AC: ein beendeter Container ist als beendet erkennbar und zeigt keine CPU-Last", async () => {
    render(<ContainerOverview />);
    expect(await screen.findByText(/beendet/)).toBeInTheDocument();
    // Nur der laufende Container (appbaua-prod-app-1) zeigt eine CPU-Last.
    expect(screen.getAllByText(/%$/)).toHaveLength(1);
  });

  it("AC: der Neustart-Knopf startet genau diesen Container neu", async () => {
    const user = userEvent.setup();
    render(<ContainerOverview />);

    await user.click(
      await screen.findByRole("button", { name: /appbaua-prod-app-1 neu starten/ }),
    );
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(restartCalls).toEqual([]);

    await user.click(screen.getByRole("button", { name: /^Neu starten$/ }));
    await waitFor(() => expect(restartCalls).toEqual([{ id: "a" }]));
  });

  it("AC (bug-021): ein langer Containername bricht um, statt die Karte aufzuschieben", async () => {
    groups = [
      {
        key: "sonstige",
        label: "Sonstige",
        memoryBytesTotal: 0,
        containers: [
          {
            id: "lang",
            name: "appbaua-prod-irgendein-sehr-langer-container-name-ohne-leerzeichen-1",
            state: "running",
            status: "Up 1 hour",
            memoryBytes: null,
            cpuPercent: null,
          },
        ],
      },
    ];
    render(<ContainerOverview />);
    const text = await screen.findByText(
      "appbaua-prod-irgendein-sehr-langer-container-name-ohne-leerzeichen-1",
    );
    expect(text.style.overflowWrap).toBe("anywhere");
  });

  it("AC: während die Messung noch läuft, sieht man das — die Seite wirkt nicht leer", async () => {
    groups = [];
    vi.stubGlobal("fetch", async () => ({
      ok: true,
      json: async () => ({ groups: [], measuring: true }),
    }));
    render(<ContainerOverview />);
    expect(await screen.findByText(/Messung läuft/)).toBeInTheDocument();
  });

  it("zeigt die Messung nicht mehr an, sobald Werte vorliegen", async () => {
    render(<ContainerOverview />);
    await screen.findByText("appbaua · prod");
    expect(screen.queryByText(/Messung läuft/)).not.toBeInTheDocument();
  });

  describe("bug-027: Balken statt nackter Zahlen", () => {
    it("der Speicher-Balken ist proportional zum größten Container, nicht gleich lang", async () => {
      groups = [
        {
          key: "g",
          label: "appbaua · prod",
          memoryBytesTotal: 500 * 1024 * 1024,
          containers: [
            {
              id: "big",
              name: "appbaua-prod-app-1",
              state: "running",
              status: "Up 3 hours",
              memoryBytes: 400 * 1024 * 1024,
              cpuPercent: 1,
            },
            {
              id: "small",
              name: "appbaua-prod-worker-1",
              state: "running",
              status: "Up 3 hours",
              memoryBytes: 100 * 1024 * 1024,
              cpuPercent: 1,
            },
          ],
        },
      ];
      const { container } = render(<ContainerOverview />);
      await screen.findByText("appbaua · prod");
      const bigBar = container.querySelector<HTMLElement>('[data-container-id="big"] [data-bar="memory"]')!;
      const smallBar = container.querySelector<HTMLElement>('[data-container-id="small"] [data-bar="memory"]')!;
      expect(bigBar.style.width).toBe("100%");
      expect(smallBar.style.width).toBe("25%");
    });

    it("ein beendeter Container ohne Messwert bekommt keinen Speicher- und keinen CPU-Balken", async () => {
      const { container } = render(<ContainerOverview />);
      await screen.findByText("appbaua · prod");
      expect(
        container.querySelector('[data-container-id="w"] [data-bar="memory"]'),
      ).not.toBeInTheDocument();
      expect(
        container.querySelector('[data-container-id="w"] [data-bar="cpu"]'),
      ).not.toBeInTheDocument();
    });
  });

  describe("bug-027: Layout nebeneinander auf breiten Bildschirmen", () => {
    it("die Gruppenkarten liegen in einem mehrspaltig fähigen Raster, nicht in einer einspaltigen Flex-Spalte", async () => {
      const { container } = render(<ContainerOverview />);
      await screen.findByText("appbaua · prod");
      const grid = container.querySelector<HTMLElement>("[data-groups-grid]")!;
      expect(grid.style.display).toBe("grid");
      expect(grid.style.gridTemplateColumns).toMatch(/auto-fit/);
    });
  });

  describe("bug-027: Neustart-Knopf als reines Symbol", () => {
    it("der Knopf zeigt keinen Text, nur das Symbol — der Name bleibt die Sicherheitsabfrage", async () => {
      render(<ContainerOverview />);
      const button = await screen.findByRole("button", { name: /appbaua-prod-app-1 neu starten/ });
      expect(button.textContent?.trim()).toBe("");
    });
  });

  describe("bug-027: Gesamtsumme über alle Gruppen", () => {
    it("zeigt eine Gesamtsumme über Speicher und CPU aller Gruppen", async () => {
      const { container } = render(<ContainerOverview />);
      await screen.findByText("appbaua · prod");
      const total = container.querySelector<HTMLElement>("[data-total-summary]")!;
      expect(total.textContent).toMatch(/Gesamt/);
      expect(total.textContent).toMatch(/412 MB.*3\.2 %/);
    });
  });
});
