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
import { Icon } from "./Icon";

// Container-Übersicht (req-042): zweite Ansicht des Zustands-Moduls, Speicher
// und CPU-Last je Container, gruppiert nach App. Wird in HealthOverview per
// Umschalter gezeigt.

/** Abrufe der Übersicht. Geprüft wird davon nichts — das entscheidet der Server. */
export const POLL_MS = 15_000;

export function ContainerOverview() {
  const [groups, setGroups] = useState<ContainerGroup[] | null>(null);
  // Vor der allerersten fertigen Messrunde (req-042, AC12) — bis dahin ist
  // "wird gemessen" die richtige Annahme, nicht "keine Container".
  const [measuring, setMeasuring] = useState(true);
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null);
  const [restarting, setRestarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health/containers", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { groups?: ContainerGroup[]; measuring?: boolean };
      setGroups(data.groups ?? []);
      setMeasuring(data.measuring ?? false);
    } catch {
      /* letzten bekannten Stand stehen lassen */
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  const doRestart = useCallback(async () => {
    if (!pending || restarting) return;
    setRestarting(true);
    try {
      const res = await fetch("/api/health/containers/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: pending.id }),
      });
      const data = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? `${pending.name} wird neu gestartet.`
          : (data.error ?? "Neustart fehlgeschlagen."),
      );
      setPending(null);
      await load();
    } catch {
      setNote("Neustart fehlgeschlagen.");
      setPending(null);
    } finally {
      setRestarting(false);
    }
  }, [pending, restarting, load]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
      {note && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 600,
            padding: "9px 12px",
            borderRadius: "var(--radius-md)",
            color: "var(--color-accent-300)",
            border: "1px solid var(--color-accent)",
            background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
          }}
        >
          <Icon name="sync" size={17} />
          <span>{note}</span>
        </div>
      )}

      {measuring && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-2)",
            padding: "var(--space-4)",
            borderRadius: "var(--radius-md)",
            border: `1px solid color-mix(in srgb, var(--color-text) 15%, transparent)`,
          }}
        >
          <Icon name="activity" size={20} />
          <div>
            <div style={{ fontWeight: 600 }}>Messung läuft …</div>
            <div style={{ fontSize: 13 }}>
              Speicher und CPU brauchen zwei Momentaufnahmen im Abstand — bei
              vielen Containern dauert das einen Moment.
            </div>
          </div>
        </div>
      )}

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
            <span style={{ fontWeight: 600, fontSize: 16, minWidth: 0, overflowWrap: "anywhere" }}>
              {g.label}
            </span>
            <span style={{ fontSize: 12, color: "var(--color-text-muted, inherit)" }}>
              {formatMemory(g.memoryBytesTotal)}
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {g.containers.map((c) => (
              <ContainerRowView key={c.id} c={c} onRestart={() => setPending({ id: c.id, name: c.name })} />
            ))}
          </div>
        </div>
      ))}

      {pending && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            padding: "var(--space-4)",
            background: "color-mix(in srgb, #000 55%, transparent)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Container neu starten?"
            style={{
              width: "100%",
              maxWidth: 320,
              background: "var(--color-surface)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <h4 style={{ margin: 0 }}>Container neu starten?</h4>
            <p style={{ margin: 0, fontSize: 14 }}>
              <strong>{pending.name}</strong> wird neu gestartet.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                marginTop: "var(--space-2)",
              }}
            >
              <button className="btn btn-secondary" onClick={() => setPending(null)}>
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={doRestart} disabled={restarting}>
                <Icon name="sync" size={16} /> Neu starten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ContainerRowView({ c, onRestart }: { c: ContainerRow; onRestart: () => void }) {
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
      {/* bug-021: Container-Namen haben Bindestriche, aber keine Leerzeichen —
          overflowWrap: "anywhere" bricht auch dort, wordBreak allein reicht in
          Safari nicht (req-042, AC11). */}
      <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{c.name}</span>
      <span style={{ overflowWrap: "anywhere" }}>
        {containerStateLabel(c.state)}
        {since ? ` · ${since}` : ""}
      </span>
      {c.memoryBytes !== null && <span>{formatMemory(c.memoryBytes)}</span>}
      {c.cpuPercent !== null && <span>{formatCpuPercent(c.cpuPercent)}</span>}
      <button
        className="btn btn-secondary"
        onClick={onRestart}
        style={{ fontSize: 12, padding: "4px 8px", marginLeft: "auto", overflowWrap: "anywhere" }}
      >
        <Icon name="sync" size={14} /> {c.name} neu starten
      </button>
    </div>
  );
}
