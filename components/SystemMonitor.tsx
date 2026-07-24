"use client";

import { useEffect, useState } from "react";
import {
  type SystemMetrics,
  UNKNOWN_METRICS,
  diskTile,
  formatPercent,
  memoryTile,
} from "@/lib/system-metrics";
import { Tile } from "./Tile";

// System-Kacheln der Einstellungsseite (req-009): Momentanwerte des Mini-PCs,
// sekündlich aktualisiert. Der Intervall hängt am Leben der Komponente — wer
// die Einstellungen verlässt, hört damit auch auf zu fragen.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** Aktualisierungstakt der Kacheln. */
export const POLL_MS = 1000;

export function SystemMonitor() {
  const [metrics, setMetrics] = useState<SystemMetrics>(UNKNOWN_METRICS);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/system-metrics", { cache: "no-store" });
        if (!res.ok) throw new Error("nicht erreichbar");
        const data = (await res.json()) as SystemMetrics;
        if (alive) setMetrics(data);
      } catch {
        // Ist der Server nicht erreichbar, ist KEIN Wert ermittelbar. Alte
        // Werte stehen zu lassen wäre irreführend.
        if (alive) setMetrics(UNKNOWN_METRICS);
      }
    };
    void load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const disk = diskTile(metrics.disk);
  const memory = memoryTile(metrics.memory);

  return (
    <section aria-label="System">
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "2px 0 var(--space-2)",
        }}
      >
        System
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-2)",
        }}
      >
        <Tile label="Freier Speicherplatz" value={disk.value} sub={disk.sub} />
        <Tile
          label="CPU-Last gesamt"
          value={formatPercent(metrics.cpu)}
          sub="Host, alle Kerne"
        />
        <Tile
          label="CPU-Last des Workers"
          value={formatPercent(metrics.workerCpu)}
          sub="Worker + Claude Code"
        />
        <Tile label="RAM" value={memory.value} sub={memory.sub} />
      </div>
    </section>
  );
}
