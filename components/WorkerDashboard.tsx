"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/dashboard";

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const POLL_MS = 5000;

/** Shown instead of a filename for types that are not file-driven (req-008). */
const RECURRING_LABEL = "wiederkehrende Aufgabe";

function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Elapsed since an ISO start, as M:SS, updated by the ticking `nowMs`. */
function elapsed(startIso: string, nowMs: number): string {
  const secs = Math.max(0, Math.floor((nowMs - new Date(startIso).getTime()) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

const PHASE_META: Record<
  DashboardData["phase"],
  { label: string; live: boolean }
> = {
  running: { label: "läuft", live: true },
  pause: { label: "Pause", live: false },
  idle: { label: "Leerlauf", live: false },
  stopped: { label: "gestoppt", live: false },
};

export function WorkerDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [nowMs, setNowMs] = useState(() => 0);

  // Poll the status every 5s.
  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/worker-status", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as DashboardData;
        if (alive) setData(d);
      } catch {
        /* keep last known state */
      }
    };
    void fetchStatus();
    const id = setInterval(fetchStatus, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Tick every second so the running timer counts up smoothly between polls.
  useEffect(() => {
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const phase = data?.phase ?? "idle";
  const meta = PHASE_META[phase];

  // Second line while a step runs: the .md being worked on, or the placeholder
  // for recurring types that have no file (req-008).
  const mdLine =
    phase === "running" ? (data?.currentMd ?? RECURRING_LABEL) : null;
  // Live Claude output — only while the step runs; afterwards the result is in
  // the Verlauf log (req-004).
  const liveOutput = phase === "running" ? (data?.currentOutput ?? "") : "";

  let statusLine = "…";
  if (data) {
    if (phase === "running" && data.currentType && data.currentRepo) {
      const dur = data.stepStartedAt ? elapsed(data.stepStartedAt, nowMs) : "0:00";
      statusLine = `${data.currentType} × ${data.currentRepo} · seit ${dur}`;
    } else if (phase === "pause" && data.pauseUntil) {
      statusLine = `Pause bis ${hhmm(data.pauseUntil)}`;
    } else if (phase === "stopped") {
      statusLine = "Worker gestoppt";
    } else {
      statusLine = "Leerlauf — nichts zu tun";
    }
  }

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
      {/* Status card */}
      <div
        className="card elev-md"
        style={{
          gap: "var(--space-2)",
          background:
            "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)), var(--color-surface))",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--color-accent-300)",
            }}
          >
            Worker
          </span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 11,
              color: "var(--color-accent-300)",
              border: "1px solid var(--color-accent)",
              padding: "2px 9px",
              borderRadius: 999,
            }}
          >
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: 999,
                flex: "none",
                background: meta.live ? "var(--color-accent)" : muted(35),
                animation: meta.live ? "wpulse 1.6s ease-in-out infinite" : "none",
              }}
            />
            {meta.label}
          </span>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.3 }}>{statusLine}</div>
        {mdLine && (
          <div
            style={{
              fontSize: 13,
              lineHeight: 1.3,
              color: muted(60),
              wordBreak: "break-word",
            }}
          >
            {mdLine}
          </div>
        )}
        {liveOutput && (
          <pre
            aria-label="Live-Ausgabe"
            style={{
              margin: "var(--space-2) 0 0",
              maxHeight: 220,
              overflow: "auto",
              padding: "var(--space-2)",
              borderRadius: "var(--radius-md)",
              background: "color-mix(in srgb, var(--color-text) 8%, transparent)",
              color: muted(72),
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 11,
              lineHeight: 1.4,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {liveOutput}
          </pre>
        )}
      </div>

      {/* Dashboard tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "var(--space-2)",
          marginTop: "var(--space-2)",
        }}
      >
        <Tile
          label="Heute"
          value={data ? `${data.today.done}` : "–"}
          sub={data ? `${data.today.errors} Fehler` : ""}
        />
        <Tile
          label="Aktive Repos"
          value={data ? `${data.activeRepos}` : "–"}
          sub={data ? `von ${data.totalRepos}` : ""}
        />
        <Tile
          label="Fällige Typen"
          value={data ? `${data.dueTypes}` : "–"}
          sub="jetzt"
        />
        <Tile
          label="Letzter Fehler"
          value={data?.lastError ? hhmm(data.lastError.at) : "—"}
          sub={data?.lastError ? "" : "Kein Fehler bisher"}
        />
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card elev-sm" style={{ gap: 2, padding: "var(--space-3)" }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11, color: muted(55) }}>{sub}</div>
      )}
    </div>
  );
}
