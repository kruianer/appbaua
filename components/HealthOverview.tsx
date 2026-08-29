"use client";

import { useCallback, useEffect, useState } from "react";
import {
  type AppHealth,
  type CheckResult,
  type ContainerInfo,
  type Lamp,
  CHECK_LABELS,
  LAMP_LABELS,
} from "@/lib/health";
import { Icon } from "./Icon";

// Zustandsseite (req-032): je überwachter App eine Karte mit Ampel und den
// einzelnen Prüfungen darunter. Neu gestartet wird ausschließlich auf Klick —
// und auch dann erst nach einer Rückfrage, weil der Neustart echte laufende
// Systeme trifft, auch prod-Umgebungen fremder Apps.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/** Abrufe der Übersicht. Geprüft wird davon nichts — das entscheidet der Server. */
export const POLL_MS = 15_000;

const LAMP_COLOR: Record<Lamp, string> = {
  green: "var(--color-ok)",
  red: "var(--color-bad)",
  unknown: "color-mix(in srgb, var(--color-text) 35%, transparent)",
};

const STATUS_TEXT: Record<CheckResult["status"], string> = {
  ok: "ok",
  fail: "Fehler",
  unknown: "unbekannt",
  unconfigured: "nicht konfiguriert",
  off: "abgeschaltet",
};

const STATUS_COLOR: Record<CheckResult["status"], string> = {
  ok: "var(--color-ok)",
  fail: "var(--color-bad)",
  unknown: muted(45),
  unconfigured: muted(45),
  off: muted(45),
};

function hhmm(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Die Container einer Karte, die einen Neustart anbieten — nur die roten. */
function failingContainers(app: AppHealth): ContainerInfo[] {
  const seen = new Set<string>();
  const out: ContainerInfo[] = [];
  for (const check of app.checks) {
    for (const c of check.containers ?? []) {
      if (!c.failing || seen.has(c.name)) continue;
      seen.add(c.name);
      out.push(c);
    }
  }
  return out;
}

export function HealthOverview() {
  const [apps, setApps] = useState<AppHealth[] | null>(null);
  const [pending, setPending] = useState<{ repoId: string; container: string } | null>(
    null,
  );
  const [restarting, setRestarting] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as { apps: AppHealth[] };
      setApps(data.apps ?? []);
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
      const res = await fetch("/api/health/restart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pending),
      });
      const data = await res.json().catch(() => ({}));
      setNote(
        res.ok
          ? `${pending.container} wird neu gestartet.`
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
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
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
            marginBottom: "var(--space-2)",
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

      {apps !== null && apps.length === 0 && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            gap: "var(--space-3)",
            padding: "var(--space-8) var(--space-4)",
            marginTop: "var(--space-6)",
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              color: "var(--color-accent-300)",
              border: "1px solid var(--color-accent)",
            }}
          >
            <Icon name="heart" size={28} />
          </div>
          <div>
            <h4 style={{ margin: "0 0 4px" }}>Keine App wird überwacht</h4>
            <p style={{ margin: 0, fontSize: 14, color: muted(60) }}>
              Schalte bei einem Repo unter „Repos“ den Schalter „überwachen“ ein.
            </p>
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
        {(apps ?? []).map((app) => (
          <div key={app.repoId} className="card elev-sm" style={{ gap: "var(--space-2)" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "var(--space-2)",
              }}
            >
              <span style={{ fontWeight: 600, fontSize: 16, minWidth: 0 }}>
                {app.repoName}
              </span>
              <span
                aria-label={`${app.repoName}: ${LAMP_LABELS[app.lamp]}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  flex: "none",
                  fontSize: 11,
                  padding: "2px 9px",
                  borderRadius: 999,
                  color: LAMP_COLOR[app.lamp],
                  border: `1px solid ${LAMP_COLOR[app.lamp]}`,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 999,
                    background: LAMP_COLOR[app.lamp],
                  }}
                />
                {LAMP_LABELS[app.lamp]}
              </span>
            </div>

            <div style={{ fontSize: 11, color: muted(50) }}>
              {app.checkedAt
                ? `zuletzt geprüft ${hhmm(app.checkedAt)}`
                : "noch nicht geprüft"}
            </div>

            <div
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              {app.checks.map((check) => (
                <div
                  key={check.kind}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: "var(--space-2)",
                    fontSize: 13,
                  }}
                >
                  <span style={{ flex: "none", color: muted(70) }}>
                    {CHECK_LABELS[check.kind]}
                  </span>
                  <span
                    style={{
                      minWidth: 0,
                      textAlign: "right",
                      color: STATUS_COLOR[check.status],
                      wordBreak: "break-word",
                    }}
                  >
                    <strong>{STATUS_TEXT[check.status]}</strong>
                    <span style={{ color: muted(55) }}>
                      {" "}
                      — {check.detail}
                      {check.checkedAt ? ` (${hhmm(check.checkedAt)})` : ""}
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {failingContainers(app).map((c) => (
              <button
                key={c.name}
                className="btn btn-secondary"
                onClick={() => setPending({ repoId: app.repoId, container: c.name })}
                style={{ alignSelf: "flex-start", fontSize: 12, padding: "6px 10px" }}
              >
                <Icon name="sync" size={15} /> {c.name} neu starten
              </button>
            ))}
          </div>
        ))}
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
            <p style={{ margin: 0, fontSize: 14, color: muted(75) }}>
              <strong>{pending.container}</strong> wird neu gestartet. Die übrigen
              Container derselben App bleiben unberührt.
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
              <button
                className="btn btn-primary"
                onClick={doRestart}
                disabled={restarting}
              >
                <Icon name="sync" size={16} /> Neu starten
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
