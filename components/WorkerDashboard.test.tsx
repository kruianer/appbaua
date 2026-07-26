import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkerDashboard } from "./WorkerDashboard";
import type { DashboardData } from "@/lib/dashboard";
import type { PreviewRow } from "@/lib/preview";

// Aktivität tab (req-005 status card + req-008 md name and live output). The
// status comes from /api/worker-status, so the component is driven against a
// stubbed fetch here.

const IDLE: DashboardData & { preview: PreviewRow[] } = {
  phase: "idle",
  currentRepo: null,
  currentType: null,
  currentMd: null,
  currentOutput: null,
  currentModel: null,
  stepStartedAt: null,
  pauseUntil: null,
  pauseReason: null,
  today: { done: 0, errors: 0 },
  activeRepos: 1,
  totalRepos: 1,
  dueTypes: 0,
  lastError: null,
  preview: [],
};

function running(
  over: Partial<DashboardData & { preview: PreviewRow[] }> = {},
): DashboardData & { preview: PreviewRow[] } {
  return {
    ...IDLE,
    phase: "running",
    currentRepo: "appbaua",
    currentType: "Requirements",
    stepStartedAt: new Date().toISOString(),
    ...over,
  };
}

function stubStatus(data: DashboardData & { preview?: PreviewRow[] }) {
  vi.stubGlobal("fetch", async () => ({ ok: true, json: async () => data }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Aktivität — laufender Schritt (req-008)", () => {
  it("AC: shows the .md being worked on under 'Typ × Repo'", async () => {
    stubStatus(running({ currentMd: "req-042-beispiel.md" }));
    render(<WorkerDashboard />);

    expect(
      await screen.findByText(/Requirements × appbaua/),
    ).toBeInTheDocument();
    expect(screen.getByText("req-042-beispiel.md")).toBeInTheDocument();
  });

  it("AC: a recurring type shows the placeholder instead of a filename", async () => {
    stubStatus(running({ currentType: "Code-Review", currentMd: null }));
    render(<WorkerDashboard />);

    expect(await screen.findByText(/Code-Review × appbaua/)).toBeInTheDocument();
    expect(screen.getByText("wiederkehrende Aufgabe")).toBeInTheDocument();
  });

  it("AC: shows the live Claude output while the step runs", async () => {
    stubStatus(
      running({
        currentMd: "req-042-beispiel.md",
        currentOutput: "Zeile 1\nZeile 2\nZeile 3",
      }),
    );
    render(<WorkerDashboard />);

    const out = await screen.findByLabelText("Live-Ausgabe");
    expect(out).toHaveTextContent("Zeile 1");
    expect(out).toHaveTextContent("Zeile 3");
  });

  it("AC: once the step is done, md line and live output are gone", async () => {
    stubStatus(IDLE);
    render(<WorkerDashboard />);

    expect(await screen.findByText("Leerlauf — nichts zu tun")).toBeInTheDocument();
    expect(screen.queryByLabelText("Live-Ausgabe")).not.toBeInTheDocument();
    expect(
      screen.queryByText("wiederkehrende Aufgabe"),
    ).not.toBeInTheDocument();
  });

  it("req-027: shows the model actually in use while the step runs", async () => {
    stubStatus(running({ currentModel: "sonnet" }));
    render(<WorkerDashboard />);
    expect(await screen.findByText("Modell: sonnet")).toBeInTheDocument();
  });

  it("req-027: shows no model field once the step is over", async () => {
    stubStatus(IDLE);
    render(<WorkerDashboard />);
    await screen.findByText("Leerlauf — nichts zu tun");
    expect(screen.queryByText(/^Modell:/)).not.toBeInTheDocument();
  });

  it("a running step without any output yet shows no empty output box", async () => {
    stubStatus(running({ currentMd: "req-042-beispiel.md", currentOutput: null }));
    render(<WorkerDashboard />);

    expect(await screen.findByText("req-042-beispiel.md")).toBeInTheDocument();
    expect(screen.queryByLabelText("Live-Ausgabe")).not.toBeInTheDocument();
  });
});

describe("Nächste Aktivitäten (req-022)", () => {
  it("AC: shows 'Nichts geplant' when the preview is empty", async () => {
    stubStatus(IDLE);
    render(<WorkerDashboard />);
    expect(await screen.findByText("Nichts geplant")).toBeInTheDocument();
  });

  it("AC: lists repo × task type, the waiting file, and the due text", async () => {
    stubStatus({
      ...IDLE,
      preview: [
        {
          repo: "appbaua",
          taskType: "Requirements",
          mdName: "req-030-beispiel.md",
          due: { kind: "queue", position: 0 },
        },
      ],
    });
    render(<WorkerDashboard />);
    expect(await screen.findByText("Requirements × appbaua")).toBeInTheDocument();
    expect(screen.getByText("req-030-beispiel.md")).toBeInTheDocument();
    expect(screen.getByText("als nächstes")).toBeInTheDocument();
  });

  it("AC: a recurring type shows the placeholder, not a filename", async () => {
    stubStatus({
      ...IDLE,
      preview: [
        {
          repo: "appbaua",
          taskType: "Code-Review",
          mdName: "wiederkehrende Aufgabe",
          due: { kind: "queue", position: 1 },
        },
      ],
    });
    render(<WorkerDashboard />);
    expect(await screen.findByText("wiederkehrende Aufgabe")).toBeInTheDocument();
    expect(screen.getByText("danach")).toBeInTheDocument();
  });

  it("AC: a scheduled type shows its next window start, not an invented time", async () => {
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(2, 0, 0, 0);
    stubStatus({
      ...IDLE,
      preview: [
        {
          repo: "appbaua",
          taskType: "Doku",
          mdName: "wiederkehrende Aufgabe",
          due: { kind: "at", at: at.toISOString() },
        },
      ],
    });
    render(<WorkerDashboard />);
    expect(await screen.findByText("Doku × appbaua")).toBeInTheDocument();
    expect(screen.getByText(/02:00/)).toBeInTheDocument();
  });
});
