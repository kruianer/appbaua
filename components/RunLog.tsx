"use client";

import { useCallback, useEffect, useState } from "react";
import { type RunLogEntry, mdLabel } from "@/lib/run-log";

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const STATUS_META: Record<
  RunLogEntry["status"],
  { label: string; color: string }
> = {
  success: { label: "Erfolg", color: "var(--color-accent-300)" },
  error: { label: "Fehler", color: "#f0a3a3" },
  idle: { label: "Leerlauf", color: "var(--color-text)" },
};

function fmt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}. ${p(d.getHours())}:${p(
    d.getMinutes(),
  )}:${p(d.getSeconds())}`;
}

export function RunLog() {
  const [entries, setEntries] = useState<RunLogEntry[]>([]);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: number) => {
    setLoading(true);
    const res = await fetch(`/api/run-log?page=${p}`);
    const data = await res.json();
    setEntries((prev) =>
      p === 0 ? data.entries : [...prev, ...data.entries],
    );
    setHasMore(data.hasMore);
    setPage(p);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load(0);
  }, [load]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "2px 0 var(--space-2)",
        }}
      >
        Verlauf · neueste zuerst
      </div>

      {entries.length === 0 && !loading ? (
        <div
          style={{
            textAlign: "center",
            padding: "var(--space-8) var(--space-4)",
            color: muted(60),
            fontSize: 14,
          }}
        >
          Noch keine Läufe protokolliert.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {entries.map((e) => {
            const s = STATUS_META[e.status];
            // Second line: the .md this run worked off (req-015). Absent on
            // entries that never recorded one — they get no line at all.
            const md = mdLabel(e);
            return (
              <div
                key={e.id}
                className="card elev-sm"
                style={{ gap: 4, padding: "var(--space-3)" }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "var(--space-2)",
                  }}
                >
                  <span style={{ fontWeight: 600, fontSize: 15, minWidth: 0 }}>
                    {e.repo && e.taskType
                      ? `${e.taskType} × ${e.repo}`
                      : "—"}
                  </span>
                  <span
                    style={{
                      flex: "none",
                      fontSize: 11,
                      fontWeight: 600,
                      color: s.color,
                      border: `1px solid ${s.color}`,
                      borderRadius: 999,
                      padding: "2px 9px",
                    }}
                  >
                    {s.label}
                  </span>
                </div>
                {md && (
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.3,
                      color: muted(60),
                      wordBreak: "break-word",
                    }}
                  >
                    {md}
                  </div>
                )}
                <div style={{ fontSize: 12, color: muted(55) }}>
                  {fmt(e.startedAt)} – {fmt(e.endedAt)}
                </div>
                {e.message && (
                  <div style={{ fontSize: 12, color: muted(70) }}>
                    {e.message}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <button
          className="btn btn-secondary btn-block"
          disabled={loading}
          onClick={() => load(page + 1)}
          style={{ marginTop: "var(--space-3)" }}
        >
          {loading ? "lädt…" : "mehr laden"}
        </button>
      )}
    </div>
  );
}
