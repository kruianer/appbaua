import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { POLL_MS, SystemMonitor } from "./SystemMonitor";
import type { SystemMetrics } from "@/lib/system-metrics";

// System-Kacheln der Einstellungsseite (req-009). Die Werte kommen von
// /api/system-metrics, deshalb läuft die Komponente hier gegen ein
// nachgebautes fetch. Echte Timer: der Sekundentakt IST das Verhalten.

const FULL: SystemMetrics = {
  disk: { freeBytes: 312_000_000_000, totalBytes: 500_000_000_000 },
  cpu: { percent: 37 },
  workerCpu: { percent: 4 },
  memory: {
    usedBytes: 12_288_000_000,
    freeBytes: 4_096_000_000,
    totalBytes: 16_384_000_000,
  },
};

/** Muss länger sein als ein Takt, damit ein ausbleibender Abruf auffällt. */
const MORE_THAN_A_TICK = POLL_MS + 500;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let current: SystemMetrics;
let calls: number;

beforeEach(() => {
  current = FULL;
  calls = 0;
  vi.stubGlobal("fetch", async (url: string) => {
    if (url.startsWith("/api/system-metrics")) calls += 1;
    return { ok: true, json: async () => current };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("System-Kacheln (req-009)", () => {
  it("AC: zeigt den Bereich System mit vier Kacheln", async () => {
    render(<SystemMonitor />);

    expect(await screen.findByText("312 GB frei")).toBeInTheDocument();
    expect(screen.getByText("System")).toBeInTheDocument();

    expect(screen.getByText("Freier Speicherplatz")).toBeInTheDocument();
    expect(screen.getByText("von 500 GB")).toBeInTheDocument();

    expect(screen.getByText("CPU-Last gesamt")).toBeInTheDocument();
    expect(screen.getByText("37 %")).toBeInTheDocument();

    expect(screen.getByText("CPU-Last des Workers")).toBeInTheDocument();
    expect(screen.getByText("4 %")).toBeInTheDocument();

    expect(screen.getByText("RAM")).toBeInTheDocument();
    expect(screen.getByText("12 GB genutzt")).toBeInTheDocument();
    expect(screen.getByText("4 GB frei von 16 GB")).toBeInTheDocument();
  });

  it("AC: nach einer Sekunde stehen neue Werte da — ohne Neuladen", async () => {
    render(<SystemMonitor />);
    await screen.findByText("37 %");

    current = { ...FULL, cpu: { percent: 88 }, workerCpu: { percent: 61 } };

    expect(
      await screen.findByText("88 %", {}, { timeout: 4000 }),
    ).toBeInTheDocument();
    expect(screen.getByText("61 %")).toBeInTheDocument();
  });

  it("AC: verlasse ich die Seite, wird nichts mehr abgefragt", async () => {
    const { unmount } = render(<SystemMonitor />);
    await screen.findByText("37 %");

    unmount();
    const afterUnmount = calls;
    await wait(MORE_THAN_A_TICK);

    expect(calls).toBe(afterUnmount);
  });

  it("AC: ein einzelner fehlender Wert trifft nur seine Kachel", async () => {
    current = { ...FULL, workerCpu: null };
    render(<SystemMonitor />);

    expect(await screen.findByText("n/v")).toBeInTheDocument();
    expect(screen.getByText("37 %")).toBeInTheDocument();
    expect(screen.getByText("312 GB frei")).toBeInTheDocument();
    expect(screen.getByText("12 GB genutzt")).toBeInTheDocument();
  });

  it("fällt der Server aus, zeigen alle vier Kacheln n/v statt alter Werte", async () => {
    render(<SystemMonitor />);
    await screen.findByText("37 %");

    vi.stubGlobal("fetch", async () => {
      throw new Error("nicht erreichbar");
    });

    await waitFor(() => expect(screen.getAllByText("n/v")).toHaveLength(4), {
      timeout: 4000,
    });
  });
});
