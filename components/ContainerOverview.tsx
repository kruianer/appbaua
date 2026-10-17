"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContainerGroup } from "@/lib/container-overview";

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
          <div style={{ fontWeight: 600, fontSize: 16 }}>{g.label}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {g.containers.map((c) => (
              <div key={c.id} style={{ fontSize: 14 }}>
                {c.name}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
