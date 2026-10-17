"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type ContainerGroup,
  type ContainerRow,
  containerSince,
  containerStateLabel,
  formatCpuPercent,
  formatMemory,
} from "@/lib/container-overview";

// Container-Übersicht (req-042): zweite Ansicht des Zustands-Moduls, Speicher
// und CPU-Last je Container, gruppiert nach App. Wird in HealthOverview per
// Umschalter gezeigt.

/** Abrufe der Übersicht. Geprüft wird davon nichts — das entscheidet der Server. */
export const POLL_MS = 15_000;

export function ContainerOverview() {
  const [groups, setGroups] = useState<ContainerGroup[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health/containers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { groups?: ContainerGroup[] };
      setGroups(data.groups ?? []);
    } catch {
      /* letzten bekannten Stand stehen lassen */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {(groups ?? []).map((g) => (
        <div key={g.key} className="card elev-sm" style={{ gap: "var(--space-2)" }}>
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              gap: "var(--space-2)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: 16, minWidth: 0 }}>{g.label}</span>
            <span style={{ fontSize: 12, color: "var(--color-text-muted, inherit)" }}>
              {formatMemory(g.memoryBytesTotal)}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.containers.map((c) => (
              <ContainerRowView key={c.id} c={c} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ContainerRowView({ c }: { c: ContainerRow }) {
  const since = containerSince(c.status);
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "baseline",
        gap: "var(--space-2)",
        fontSize: 13,
      }}
    >
      <span style={{ fontWeight: 600, wordBreak: "break-word" }}>{c.name}</span>
      <span style={{ wordBreak: "break-word" }}>
        {containerStateLabel(c.state)}
        {since ? ` · ${since}` : ""}
      </span>
      {c.memoryBytes !== null && <span>{formatMemory(c.memoryBytes)}</span>}
      {c.cpuPercent !== null && <span>{formatCpuPercent(c.cpuPercent)}</span>}
    </div>
  );
}
