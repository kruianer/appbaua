import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HealthOverview } from "./HealthOverview";
import type { AppHealth } from "@/lib/health";
import type { HeartbeatView } from "@/lib/heartbeat-service";

// Die Zustandsseite aus Sicht des Nutzers (req-032): was auf einer Karte steht,
// und was ein Klick auf "Neu starten" auslöst.

const AT = "2026-08-29T12:34:00.000Z";

/** Die Karte einer App, deren Watchdog in der Neustart-Schleife hängt. */
const broken: AppHealth = {
  repoId: "r1",
  repoName: "LivingGardenTwin",
  repoUrl: "github.com/kruianer/livinggardentwin",
  lamp: "red",
  checkedAt: AT,
  checks: [
    {
      kind: "container",
      status: "fail",
      detail: "lgt-prod-monitoring-watchdog (Neustart-Schleife)",
      checkedAt: AT,
      containers: [
        { id: "a", name: "lgt-prod-app", state: "running", status: "Up", failing: false },
        {
          id: "b",
          name: "lgt-prod-monitoring-watchdog",
          state: "restarting",
          status: "Restarting (1) 5 seconds ago",
          failing: true,
        },
      ],
    },
    { kind: "database", status: "ok", detail: "livinggarden antwortet", checkedAt: AT },
    { kind: "web", status: "unconfigured", detail: "nicht konfiguriert", checkedAt: AT },
    { kind: "zigbee", status: "unconfigured", detail: "nicht konfiguriert", checkedAt: AT },
    { kind: "ai", status: "off", detail: "in den Einstellungen abgeschaltet", checkedAt: null },
  ],
};

/** Die Karte direkt nach dem Start: noch kein einziges Ergebnis. */
const pending: AppHealth = {
  repoId: "r2",
  repoName: "appbaua",
  repoUrl: "github.com/kruianer/appbaua",
  lamp: "unknown",
  checkedAt: null,
  checks: [
    { kind: "container", status: "unknown", detail: "noch nicht geprüft", checkedAt: null },
  ],
};

let apps: AppHealth[];
let heartbeat: HeartbeatView | undefined;
let restartCalls: { repoId: string; container: string }[];
let analyzeCalls: { repoId: string }[];
/** Was die Analyse auf die Karte legt, sobald sie gelaufen ist (req-035). */
let analysisResult: AppHealth["analysis"];

beforeEach(() => {
  apps = [broken];
  heartbeat = {
    configured: true,
    intervalMinutes: 5,
    acceptedAt: AT,
    error: null,
  };
  restartCalls = [];
  analyzeCalls = [];
  analysisResult = null;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/health/restart" && init?.method === "POST") {
      restartCalls.push(JSON.parse(String(init.body)));
      return { ok: true, json: async () => ({ container: "ok" }) };
    }
    if (url === "/api/health/analyze" && init?.method === "POST") {
      analyzeCalls.push(JSON.parse(String(init.body)));
      apps = apps.map((a) => ({ ...a, analysis: analysisResult }));
      return { ok: true, json: async () => ({ analysis: analysisResult }) };
    }
    return { ok: true, json: async () => ({ apps, heartbeat }) };
  });
});

describe("Zustandsseite (req-032)", () => {
  it("AC: die Container-Prüfung steht auf Rot und nennt den Container", async () => {
    render(<HealthOverview />);
    expect(
      await screen.findByText(/lgt-prod-monitoring-watchdog \(Neustart-Schleife\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("LivingGardenTwin: gestört"),
    ).toBeInTheDocument();
  });

  it("zeigt jede Prüfart mit ihrem Ergebnis", async () => {
    render(<HealthOverview />);
    await screen.findByText("Container");
    for (const label of ["Container", "Datenbank", "Web", "Datenfluss (Zigbee)", "KI-Anbieter"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getAllByText("nicht konfiguriert")).toHaveLength(2);
    expect(screen.getByText("abgeschaltet")).toBeInTheDocument();
  });

  it("AC: ohne Prüfergebnis steht 'noch nicht geprüft' da, keine leere Seite", async () => {
    apps = [pending];
    render(<HealthOverview />);
    expect(await screen.findByText("appbaua")).toBeInTheDocument();
    expect(screen.getAllByText("noch nicht geprüft").length).toBeGreaterThan(0);
  });

  it("AC: ohne überwachte App erklärt die Seite, wie man eine einschaltet", async () => {
    apps = [];
    render(<HealthOverview />);
    expect(await screen.findByText("Keine App wird überwacht")).toBeInTheDocument();
  });

  it("bietet den Neustart nur für den roten Container an", async () => {
    render(<HealthOverview />);
    expect(
      await screen.findByRole("button", {
        name: /lgt-prod-monitoring-watchdog neu starten/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /lgt-prod-app neu starten/ }),
    ).not.toBeInTheDocument();
  });

  it("AC: der Neustart geht an genau diesen Container — und erst nach Rückfrage", async () => {
    const user = userEvent.setup();
    render(<HealthOverview />);

    await user.click(
      await screen.findByRole("button", {
        name: /lgt-prod-monitoring-watchdog neu starten/,
      }),
    );
    // Erst die Rückfrage: der Neustart trifft ein echtes laufendes System.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(restartCalls).toEqual([]);

    await user.click(screen.getByRole("button", { name: /^Neu starten$/ }));
    await waitFor(() =>
      expect(restartCalls).toEqual([
        { repoId: "r1", container: "lgt-prod-monitoring-watchdog" },
      ]),
    );
  });

  it("AC (req-034): zeigt, wann der Wächter den letzten Herzschlag annahm", async () => {
    render(<HealthOverview />);
    expect(
      await screen.findByText(/Herzschlag angenommen \d\d:\d\d · alle 5 Min/),
    ).toBeInTheDocument();
  });

  it("sagt es, wenn gar kein Wächter hinterlegt ist (req-034)", async () => {
    heartbeat = { configured: false, intervalMinutes: 5, acceptedAt: null, error: null };
    render(<HealthOverview />);
    expect(
      await screen.findByText("Herzschlag: kein Wächter hinterlegt"),
    ).toBeInTheDocument();
  });

  it("nennt den Grund, wenn der letzte Herzschlag nicht ankam (req-034)", async () => {
    heartbeat = {
      configured: true,
      intervalMinutes: 5,
      acceptedAt: AT,
      error: "Wächter antwortet mit 403",
    };
    render(<HealthOverview />);
    expect(await screen.findByText(/Wächter antwortet mit 403/)).toBeInTheDocument();
  });

  it("AC (req-035): der Knopf startet die Analyse, das Ergebnis steht auf derselben Karte", async () => {
    analysisResult = {
      repoId: "r1",
      at: AT,
      trigger: "manual",
      status: "finding",
      summary: "Der Watchdog stirbt alle 20 Sekunden an fehlendem Speicher.",
    };
    const user = userEvent.setup();
    render(<HealthOverview />);

    await user.click(
      await screen.findByRole("button", { name: /Logs analysieren/ }),
    );

    await waitFor(() => expect(analyzeCalls).toEqual([{ repoId: "r1" }]));
    expect(
      await screen.findByText(
        "Der Watchdog stirbt alle 20 Sekunden an fehlendem Speicher.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/KI-Log-Analyse \(\d\d:\d\d\)/)).toBeInTheDocument();
  });

  it("AC (req-035): ohne Auffälligkeit steht genau das mit Zeitpunkt auf der Karte", async () => {
    apps = [
      {
        ...broken,
        analysis: {
          repoId: "r1",
          at: AT,
          trigger: "scheduled",
          status: "clear",
          summary: "keine Auffälligkeiten",
        },
      },
    ];
    render(<HealthOverview />);

    expect(await screen.findByText("keine Auffälligkeiten")).toBeInTheDocument();
    expect(screen.getByText(/KI-Log-Analyse \(\d\d:\d\d\)/)).toBeInTheDocument();
  });

  it("AC (req-035): ohne Analyse steht auch kein Analyse-Ergebnis auf der Karte", async () => {
    render(<HealthOverview />);
    await screen.findByText("Container");
    expect(screen.queryByText(/KI-Log-Analyse/)).not.toBeInTheDocument();
  });

  it("bricht die Rückfrage ab, ohne etwas anzufassen", async () => {
    const user = userEvent.setup();
    render(<HealthOverview />);
    await user.click(
      await screen.findByRole("button", {
        name: /lgt-prod-monitoring-watchdog neu starten/,
      }),
    );
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(restartCalls).toEqual([]);
  });
});
