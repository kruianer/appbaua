"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

// req-023 AC7: a lost passkey device is replaced with a fresh one via a
// one-time backup code. Successfully redeeming re-issues the whole backup
// code set (auth-recovery), which this shows once, same as first registration.
export default function RecoveryPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  async function recover() {
    setBusy(true);
    setError(null);
    try {
      const startRes = await fetch("/api/auth/recovery/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      if (!startRes.ok) {
        setError("Ungültiger oder bereits verwendeter Code.");
        return;
      }
      const { token, options } = await startRes.json();
      const response = await startRegistration({ optionsJSON: options });
      const finishRes = await fetch("/api/auth/recovery/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, response }),
      });
      if (!finishRes.ok) {
        setError("Wiederherstellung fehlgeschlagen.");
        return;
      }
      const finished = await finishRes.json();
      setBackupCodes(finished.backupCodes ?? []);
    } catch {
      setError("Wiederherstellung fehlgeschlagen oder abgebrochen.");
    } finally {
      setBusy(false);
    }
  }

  if (backupCodes) {
    return (
      <div
        style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "var(--space-4)" }}
      >
        <div className="card elev-md" style={{ maxWidth: 420, width: "100%", gap: "var(--space-4)" }}>
          <div style={{ fontWeight: 700, fontSize: 18 }}>Zugang wiederhergestellt</div>
          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Neue Backup-Codes — die alten sind ungültig. Nur diese eine Ansicht.
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 6,
              fontFamily: "var(--font-mono, ui-monospace, monospace)",
              fontSize: 13,
              background: "color-mix(in srgb, var(--color-text) 6%, transparent)",
              borderRadius: "var(--radius-md)",
              padding: "var(--space-3)",
            }}
          >
            {backupCodes.map((c) => (
              <div key={c}>{c}</div>
            ))}
          </div>
          <button
            className="btn btn-primary btn-block"
            onClick={() => {
              router.push("/");
              router.refresh();
            }}
          >
            Gesichert — weiter
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: "var(--space-4)" }}
    >
      <div className="card elev-md" style={{ maxWidth: 360, width: "100%", gap: "var(--space-4)" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>Zugang wiederherstellen</div>
          <div style={{ fontSize: 13, opacity: 0.6 }}>
            Gib einen deiner Backup-Codes ein.
          </div>
        </div>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder="XXXX-XXXX-XXXX-XXXX"
          style={{
            fontFamily: "var(--font-mono, ui-monospace, monospace)",
            fontSize: 14,
            padding: "10px 12px",
            borderRadius: "var(--radius-md)",
            border: "1px solid color-mix(in srgb, var(--color-text) 20%, transparent)",
            background: "var(--color-surface)",
            color: "var(--color-text)",
          }}
        />
        <button
          className="btn btn-primary btn-block"
          onClick={recover}
          disabled={busy || code.trim().length === 0}
        >
          {busy ? "Wird geprüft …" : "Zugang wiederherstellen"}
        </button>
        {error && (
          <div style={{ color: "var(--color-accent-300)", fontSize: 13 }}>{error}</div>
        )}
        <a href="/login" style={{ fontSize: 13, textAlign: "center" }}>
          Zurück zur Anmeldung
        </a>
      </div>
    </div>
  );
}
