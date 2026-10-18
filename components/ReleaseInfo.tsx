"use client";

import { useEffect, useState } from "react";
import type { ReleaseInfoEntry } from "@/lib/release-info-source";

// Release-Infos aller Repos, neueste zuerst (req-046 AC7/AC8). Gleiches
// Scroll-Muster wie der Verlauf (bug-021): vertikal scrollen ja, seitlich
// verschieben nein — Text bricht stattdessen um.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

function fmtDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

export function ReleaseInfo() {
  const [entries, setEntries] = useState<ReleaseInfoEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/release-info")
      .then((r) => r.json())
      .then((d: { entries?: ReleaseInfoEntry[] }) => {
        if (!cancelled) setEntries(d.entries ?? []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div
      data-releaseinfo-scroll
      style={{
        flex: 1,
        overflowY: "auto",
        overflowX: "clip",
        padding: "0 20px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "2px 0 var(--space-2)",
        }}
      >
        Release-Infos · neueste zuerst
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
          Noch keine Release-Infos.
        </div>
      ) : (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
          }}
        >
          {entries.map((e, i) => (
            <div
              key={`${e.repoName}-${e.packageId}-${i}`}
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
                <span
                  style={{
                    fontWeight: 600,
                    fontSize: 15,
                    minWidth: 0,
                    overflowWrap: "anywhere",
                  }}
                >
                  {e.repoName} · {e.packageId}
                </span>
                <span style={{ flex: "none", fontSize: 12, color: muted(55) }}>
                  {fmtDate(e.date)}
                </span>
              </div>
              <div
                style={{
                  fontSize: 14,
                  lineHeight: 1.4,
                  overflowWrap: "anywhere",
                }}
              >
                {e.text}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
