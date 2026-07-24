"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { SystemMonitor } from "./SystemMonitor";

// Einstellungsseite (req-007): der Zustand des Mini-PCs (req-009) und das
// Löschen des ganzen Verlauf-Logs, dazu ein Platzhalter für das, was folgt.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** How long the "Verlauf gelöscht" confirmation stays visible. */
const TOAST_MS = 3000;

function countLabel(total: number | null): string {
  if (total === null) return "Einträge werden geladen…";
  return `Aktuell ${total} ${total === 1 ? "Eintrag" : "Einträge"} im Verlauf`;
}

export function Settings() {
  const [total, setTotal] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [toast, setToast] = useState(false);

  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/run-log?page=0", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      setTotal(Number(data.total ?? 0));
    } catch {
      /* keep the last known count */
    }
  }, []);

  useEffect(() => {
    void loadCount();
  }, [loadCount]);

  // Auto-hide the confirmation again.
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(false), TOAST_MS);
    return () => clearTimeout(id);
  }, [toast]);

  const doClear = useCallback(async () => {
    if (clearing) return;
    setClearing(true);
    try {
      const res = await fetch("/api/run-log", { method: "DELETE" });
      if (!res.ok) return;
      setConfirmOpen(false);
      setTotal(0);
      setToast(true);
    } finally {
      setClearing(false);
    }
  }, [clearing]);

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
      <SystemMonitor />

      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "var(--space-4) 0 var(--space-2)",
        }}
      >
        Verlauf-Log löschen
      </div>

      <div className="card elev-sm" style={{ gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: 13, color: muted(70) }}>
          Entfernt ALLE Verlaufseinträge auf einmal. Das ist unabhängig von der
          automatischen Kürzung (älter als 1 Jahr oder mehr als 1 Mio Einträge)
          — die bleibt davon unberührt. Repos, Task-Typen und der aktuelle
          Worker-Status bleiben unverändert.
        </p>

        <div style={{ fontSize: 14, fontWeight: 600 }}>{countLabel(total)}</div>

        <button
          className="btn btn-primary btn-block"
          onClick={() => setConfirmOpen(true)}
          style={{ marginTop: 0 }}
        >
          <Icon name="trash" size={16} /> Verlauf-Log löschen
        </button>

        {toast && (
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
              background:
                "color-mix(in srgb, var(--color-accent) 14%, transparent)",
            }}
          >
            <Icon name="check" size={17} />
            <span>Verlauf gelöscht</span>
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: "var(--space-4)",
          textAlign: "center",
          fontSize: 12,
          color: muted(45),
        }}
      >
        weitere Einstellungen folgen
      </div>

      {confirmOpen && (
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
            aria-label="Verlauf löschen?"
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
            <h4 style={{ margin: 0 }}>Verlauf löschen?</h4>
            <p style={{ margin: 0, fontSize: 14, color: muted(75) }}>
              Gesamten Verlauf wirklich löschen? Das lässt sich nicht rückgängig
              machen.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                marginTop: "var(--space-2)",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmOpen(false)}
              >
                Abbrechen
              </button>
              <button
                className="btn btn-primary"
                onClick={doClear}
                disabled={clearing}
              >
                <Icon name="trash" size={16} /> Löschen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
