"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication } from "@simplewebauthn/browser";

// req-023 AC2: passkey login. Usernameless — the browser's own credential
// picker offers whichever passkeys it has for this rpId, so there is no
// username field here at all.
export default function LoginPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // AC1: without this, a fresh install had no visible way to reach the
  // operator bootstrap — only "kein Passkey" login or "Backup-Code", neither
  // of which can work before anyone has registered. Shown only while truly
  // unbootstrapped, so it never reads as an open self-registration (AC6).
  const [bootstrapped, setBootstrapped] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/auth/bootstrap/status", { cache: "no-store" });
        const data = await res.json();
        setBootstrapped(Boolean(data.bootstrapped));
      } catch {
        setBootstrapped(true); // fail closed: no link shown on doubt
      }
    })();
  }, []);

  async function login() {
    setBusy(true);
    setError(null);
    try {
      const startRes = await fetch("/api/auth/login/start", { method: "POST" });
      const { token, options } = await startRes.json();
      const response = await startAuthentication({ optionsJSON: options });
      const finishRes = await fetch("/api/auth/login/finish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, response }),
      });
      if (!finishRes.ok) {
        setError("Anmeldung fehlgeschlagen.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Anmeldung fehlgeschlagen oder abgebrochen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-4)",
      }}
    >
      <div className="card elev-md" style={{ maxWidth: 360, width: "100%", gap: "var(--space-4)" }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 20 }}>appbaua</div>
          <div style={{ fontSize: 13, color: "var(--color-text)", opacity: 0.6 }}>
            Anmeldung mit Passkey
          </div>
        </div>
        <button
          className="btn btn-primary btn-block"
          onClick={login}
          disabled={busy}
        >
          {busy ? "Wird angemeldet …" : "Mit Passkey anmelden"}
        </button>
        {error && (
          <div style={{ color: "var(--color-accent-300)", fontSize: 13 }}>{error}</div>
        )}
        {bootstrapped === false && (
          <a href="/register" style={{ fontSize: 13, textAlign: "center" }}>
            Noch kein Zugang? Ersteinrichtung starten
          </a>
        )}
        <a href="/recovery" style={{ fontSize: 13, textAlign: "center" }}>
          Zugang verloren? Mit Backup-Code wiederherstellen
        </a>
      </div>
    </div>
  );
}
