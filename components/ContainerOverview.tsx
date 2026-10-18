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

  // Bezugswert der Balken (bug-027): der größte Container über ALLE Gruppen
  // hinweg, nicht je Gruppe — der Vergleich untereinander ist die Auskunft,
  // die diese Ansicht geben soll ("wer frisst den Speicher?").
  const allContainers = (groups ?? []).flatMap((g) => g.containers);
  const maxMemoryBytes = Math.max(0, ...allContainers.map((c) => c.memoryBytes ?? 0));
  const maxCpuPercent = Math.max(0, ...allContainers.map((c) => c.cpuPercent ?? 0));

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

      {groups && groups.length > 0 && (
        <div
          className="card elev-sm"
          data-total-summary
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "var(--space-2)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontWeight: 700, fontSize: 15 }}>Gesamt</span>
          <span style={{ fontWeight: 700, fontSize: 15 }}>
            {formatMemory(sumMemoryBytes(groups))} Speicher ·{" "}
            {formatCpuPercent(sumCpuPercent(groups))} CPU
          </span>
        </div>
      )}

      <div
        data-groups-grid
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))",
          gap: "var(--space-2)",
        }}
      >
        {(groups ?? []).map((g) => {
          const cpuTotal = sumCpuPercent([g]);
          return (
            <div
              key={g.key}
              className="card elev-sm"
              data-group-key={g.key}
              style={{ gap: "var(--space-2)" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  gap: "var(--space-2)",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{ fontWeight: 600, fontSize: 16, minWidth: 0, overflowWrap: "anywhere" }}
                >
                  {g.label}
                </span>
                <span data-group-summary style={{ fontSize: 13, fontWeight: 600 }}>
                  {formatMemory(g.memoryBytesTotal)} Speicher · {formatCpuPercent(cpuTotal)} CPU
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {g.containers.map((c) => (
                  <ContainerRowView
                    key={c.id}
                    c={c}
                    maxMemoryBytes={maxMemoryBytes}
                    maxCpuPercent={maxCpuPercent}
                    onRestart={() => setPending({ id: c.id, name: c.name })}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

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

function sumMemoryBytes(groups: ContainerGroup[]): number {
  return groups.reduce((sum, g) => sum + g.memoryBytesTotal, 0);
}

function sumCpuPercent(groups: ContainerGroup[]): number {
  return groups.reduce(
    (sum, g) => sum + g.containers.reduce((s, c) => s + (c.cpuPercent ?? 0), 0),
    0,
  );
}

function ContainerRowView({
  c,
  maxMemoryBytes,
  maxCpuPercent,
  onRestart,
}: {
  c: ContainerRow;
  maxMemoryBytes: number;
  maxCpuPercent: number;
  onRestart: () => void;
}) {
  const since = containerSince(c.status);
  return (
    <div
      data-container-id={c.id}
      style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: "var(--space-2)" }}>
        {/* bug-021: Container-Namen haben Bindestriche, aber keine Leerzeichen —
            overflowWrap: "anywhere" bricht auch dort, wordBreak allein reicht in
            Safari nicht (req-042, AC11). */}
        <span style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{c.name}</span>
        <span style={{ overflowWrap: "anywhere" }}>
          {containerStateLabel(c.state)}
          {since ? ` · ${since}` : ""}
        </span>
        <button
          className="btn btn-icon btn-secondary"
          aria-label={`${c.name} neu starten`}
          onClick={onRestart}
          style={{ width: 28, height: 28, marginLeft: "auto", flex: "none" }}
        >
          <Icon name="sync" size={14} />
        </button>
      </div>
      {(c.memoryBytes !== null || c.cpuPercent !== null) && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--space-3)" }}>
          {c.memoryBytes !== null && (
            <MetricBar kind="memory" label={formatMemory(c.memoryBytes)} value={c.memoryBytes} max={maxMemoryBytes} />
          )}
          {c.cpuPercent !== null && (
            <MetricBar kind="cpu" label={formatCpuPercent(c.cpuPercent)} value={c.cpuPercent} max={maxCpuPercent} />
          )}
        </div>
      )}
    </div>
  );
}

/** Ein Balken, dessen Länge im Verhältnis zum größten Wert über alle Container steht (bug-027). */
function MetricBar({
  kind,
  label,
  value,
  max,
}: {
  kind: "memory" | "cpu";
  label: string;
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, flex: "1 1 140px", minWidth: 120 }}>
      <div
        aria-hidden="true"
        style={{
          flex: 1,
          height: 6,
          borderRadius: "var(--radius-md)",
          background: "color-mix(in srgb, var(--color-text) 12%, transparent)",
          overflow: "hidden",
        }}
      >
        <div
          data-bar={kind}
          style={{
            width: `${pct}%`,
            height: "100%",
            borderRadius: "var(--radius-md)",
            background:
              kind === "memory"
                ? "var(--color-accent)"
                : "color-mix(in srgb, var(--color-text) 55%, transparent)",
          }}
        />
      </div>
      <span style={{ fontSize: 12, flex: "none", minWidth: 44, textAlign: "right" }}>{label}</span>
    </div>
  );
}
