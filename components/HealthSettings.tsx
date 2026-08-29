"use client";

import { useCallback, useEffect, useState } from "react";
import { type CheckKind, CHECK_KINDS, CHECK_LABELS } from "@/lib/health";
import {
  type HealthSettings as Settings,
  DEFAULT_HEALTH_SETTINGS,
  MIN_AI_INTERVAL_HOURS,
  MIN_INTERVAL_MINUTES,
} from "@/lib/health-settings";

// Abschnitt "App-Überwachung" der Einstellungsseite (req-032): wie oft geprüft
// wird, und welche Prüfarten überhaupt laufen. Die KI-Prüfung hat ihren eigenen,
// viel längeren Abstand, weil jeder Aufruf beim Anbieter Geld kostet.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** Der Abstand, den die KI-Prüfung benutzt — die übrigen den kurzen. */
const AI_KIND: CheckKind = "ai";

export function HealthSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_HEALTH_SETTINGS);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/health/settings", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (data.settings) setSettings(data.settings as Settings);
      } catch {
        /* Vorgaben stehen lassen */
      }
    })();
  }, []);

  const save = useCallback(async (next: Settings) => {
    setSettings(next); // optimistisch, wie bei den übrigen Schaltern der App
    try {
      const res = await fetch("/api/health/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.settings) setSettings(data.settings as Settings);
    } catch {
      /* der nächste Besuch der Seite liest den echten Stand */
    }
  }, []);

  return (
    <>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
          margin: "var(--space-4) 0 var(--space-2)",
        }}
      >
        App-Überwachung
      </div>

      <div className="card elev-sm" style={{ gap: "var(--space-3)" }}>
        <p style={{ margin: 0, fontSize: 13, color: muted(70) }}>
          Wie oft appbaua die überwachten Apps prüft. Die KI-Prüfung läuft in
          ihrem eigenen, längeren Abstand — jeder Aufruf beim Anbieter kostet
          Geld.
        </p>

        <div className="field">
          <label htmlFor="health-interval">Prüfabstand (Minuten)</label>
          <input
            id="health-interval"
            className="input"
            type="number"
            min={MIN_INTERVAL_MINUTES}
            value={settings.intervalMinutes}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                intervalMinutes: Number(e.target.value),
              }))
            }
            onBlur={() => void save(settings)}
          />
        </div>

        <div className="field">
          <label htmlFor="health-ai-interval">Abstand der KI-Prüfung (Stunden)</label>
          <input
            id="health-ai-interval"
            className="input"
            type="number"
            min={MIN_AI_INTERVAL_HOURS}
            value={settings.aiIntervalHours}
            onChange={(e) =>
              setSettings((s) => ({
                ...s,
                aiIntervalHours: Number(e.target.value),
              }))
            }
            onBlur={() => void save(settings)}
          />
        </div>

        {CHECK_KINDS.map((kind) => (
          <div
            key={kind}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "var(--space-2)",
            }}
          >
            <span style={{ fontSize: 14 }}>
              {CHECK_LABELS[kind]}
              {kind === AI_KIND && (
                <span style={{ fontSize: 12, color: muted(55) }}> · kostet Geld</span>
              )}
            </span>
            <button
              role="switch"
              aria-checked={settings.checks[kind]}
              aria-label={`Prüfart ${CHECK_LABELS[kind]}`}
              onClick={() =>
                void save({
                  ...settings,
                  checks: { ...settings.checks, [kind]: !settings.checks[kind] },
                })
              }
              style={{
                flex: "none",
                width: 46,
                height: 28,
                borderRadius: 999,
                border: "none",
                padding: 3,
                display: "flex",
                cursor: "pointer",
                justifyContent: settings.checks[kind] ? "flex-end" : "flex-start",
                background: settings.checks[kind]
                  ? "var(--color-accent)"
                  : "color-mix(in srgb, var(--color-text) 22%, transparent)",
                transition: "background .15s ease",
              }}
            >
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 999,
                  background: "var(--color-bg)",
                  boxShadow: "0 1px 2px rgba(0,0,0,.4)",
                }}
              />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
