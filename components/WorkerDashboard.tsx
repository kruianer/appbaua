"use client";

import { useEffect, useState } from "react";
import type { DashboardData } from "@/lib/dashboard";
import type { PreviewRow } from "@/lib/preview";
import { RECURRING_MD_LABEL } from "@/lib/run-log";
import { Tile } from "./Tile";

/** DashboardData plus the "Nächste Aktivitäten" preview (req-022). */
type StatusResponse = DashboardData & { preview: PreviewRow[] };

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const POLL_MS = 5000;

/**
 * Shown instead of a filename for types that are not file-driven (req-008).
 * Shared with the Verlauf, which says the same thing about a finished run
 * (req-015) — the two must not drift apart.
 */
const RECURRING_LABEL = RECURRING_MD_LABEL;

function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The "wann" text of one preview row (req-022): a queue position never
 * invents a clock time — "als nächstes" for the very next thing the worker
 * will do, "danach" for the following queued entry, "in der Warteschlange"
 * for everything further back. A scheduled type instead gets its real next
 * window start, with the date spelled out once it is not today.
 */
function dueText(row: PreviewRow, now: Date): string {
  if (row.due.kind === "queue") {
    if (row.due.position === 0) return "als nächstes";
    if (row.due.position === 1) return "danach";
    return "in der Warteschlange";
  }
  const at = new Date(row.due.at);
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  if (sameDay) return `ab ${hhmm(row.due.at)}`;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(at.getDate())}.${p(at.getMonth() + 1)}. ${hhmm(row.due.at)}`;
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
  const [data, setData] = useState<StatusResponse | null>(null);
  const [nowMs, setNowMs] = useState(() => 0);

  // Poll the status every 5s. The preview field inside this same response is
  // NOT rebuilt by this poll — the worker loop rebuilds it after every pass
  // (req-022); this just reads whatever it last wrote.
  useEffect(() => {
    let alive = true;
    const fetchStatus = async () => {
      try {
        const res = await fetch("/api/worker-status", { cache: "no-store" });
        if (!res.ok) return;
        const d = (await res.json()) as StatusResponse;
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
  // The model actually in use (req-027) — null until the run's own init event
  // names it, and always null once the step is over.
  const modelLine =
    phase === "running" && data?.currentModel ? `Modell: ${data.currentModel}` : null;

  let statusLine = "…";
  if (data) {
    if (phase === "running" && data.currentType && data.currentRepo) {
      const dur = data.stepStartedAt ? elapsed(data.stepStartedAt, nowMs) : "0:00";
      statusLine = `${data.currentType} × ${data.currentRepo} · seit ${dur}`;
    } else if (phase === "pause" && data.pauseUntil) {
      // A rate-limit pause carries its own reason (req-029); the empty pause
      // shows the plain wait.
      statusLine = data.pauseReason
        ? `${data.pauseReason} ${hhmm(data.pauseUntil)}`
        : `Pause bis ${hhmm(data.pauseUntil)}`;
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
        {modelLine && (
          <div
            style={{
              display: "inline-flex",
              alignSelf: "flex-start",
              fontSize: 11,
              fontWeight: 600,
              color: "var(--color-accent-300)",
              border: "1px solid var(--color-accent)",
              padding: "1px 8px",
              borderRadius: 999,
            }}
          >
            {modelLine}
          </div>
        )}
        {liveOutput && (
          <pre
            aria-label="Live-Ausgabe"
            style={{
              margin: "var(--space-2) 0 0",
              // req-022: half as tall as before — the user wants to see THAT
              // something is happening, not read it in detail.
              maxHeight: 110,
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

      {/* req-022: "Nächste Aktivitäten" — what the worker will do next, in the
          same order it actually works (repo outer, task type inner, bug-008),
          rebuilt by the worker itself after every pass. */}
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "var(--space-4) 0 var(--space-2)",
        }}
      >
        Nächste Aktivitäten
      </div>
      {data && (data.preview ?? []).length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "var(--space-4)",
            color: muted(55),
            fontSize: 13,
          }}
        >
          Nichts geplant
        </div>
      ) : (
        <div
          style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}
        >
          {(data?.preview ?? []).map((row, i) => (
            <div
              key={`${row.repo}-${row.taskType}-${i}`}
              className="card elev-sm"
              style={{ gap: 2, padding: "var(--space-3)" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "var(--space-2)",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: 14, minWidth: 0 }}>
                  {row.taskType} × {row.repo}
                </span>
                <span
                  style={{
                    flex: "none",
                    fontSize: 11,
                    color: muted(60),
                  }}
                >
                  {dueText(row, new Date(nowMs || Date.now()))}
                </span>
              </div>
              <div style={{ fontSize: 12, color: muted(60), wordBreak: "break-word" }}>
                {row.mdName}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
