"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { startRegistration } from "@simplewebauthn/browser";

// req-023: covers two entry points into the SAME ceremony —
// - AC1: the operator bootstrap, when no user exists yet at all (no token).
// - AC5: redeeming an invitation (?invite=<token> in the URL).
// Both end the same way: a passkey is registered and the fresh backup codes
// are shown once (req-023 recovery) before the user moves on.

type Step = "start" | "codes";

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const inviteToken = params.get("invite");

  const [step, setStep] = useState<Step>("start");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);

  async function register() {
    setBusy(true);
    setError(null);
    try {
      const startUrl = inviteToken
        ? `/api/auth/invitations/${inviteToken}/start`
        : "/api/auth/bootstrap/start";
      const finishUrl = inviteToken
        ? `/api/auth/invitations/${inviteToken}/finish`
        : "/api/auth/bootstrap/finish";

      const startRes = await fetch(startUrl, { method: "POST" });
      if (!startRes.ok) {
        const body = await startRes.json().catch(() => ({}));
        setError(
          body.error === "already-bootstrapped"
            ? "Es existiert bereits ein Betreiber-Zugang. Bitte melde dich an."
            : "Registrierung nicht möglich (Einladung ungültig oder abgelaufen).",
        );
        return;
      }
      const started = await startRes.json();
      const token: string = started.token ?? started.registrationToken;
      const response = await startRegistration({ optionsJSON: started.options });

      const finishRes = await fetch(finishUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, response }),
      });
      if (!finishRes.ok) {
        setError("Registrierung fehlgeschlagen.");
        return;
      }
      const finished = await finishRes.json();
      setBackupCodes(finished.backupCodes ?? []);
      setStep("codes");
    } catch {
      setError("Registrierung fehlgeschlagen oder abgebrochen.");
    } finally {
      setBusy(false);
    }
  }

  if (step === "codes") {
    return (
      <div className="card elev-md" style={{ maxWidth: 420, width: "100%", gap: "var(--space-4)" }}>
        <div style={{ fontWeight: 700, fontSize: 18 }}>Backup-Codes sichern</div>
        <div style={{ fontSize: 13, opacity: 0.75 }}>
          Diese Codes werden nur EINMAL angezeigt. Bewahre sie sicher auf — jeder
          ist einmal verwendbar, falls du dein Passkey-Gerät verlierst.
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
    );
  }

  return (
    <div className="card elev-md" style={{ maxWidth: 360, width: "100%", gap: "var(--space-4)" }}>
      <div>
        <div style={{ fontWeight: 700, fontSize: 20 }}>appbaua</div>
        <div style={{ fontSize: 13, opacity: 0.6 }}>
          {inviteToken ? "Einladung annehmen" : "Ersteinrichtung — Betreiber-Zugang"}
        </div>
      </div>
      <button className="btn btn-primary btn-block" onClick={register} disabled={busy}>
        {busy ? "Wird registriert …" : "Passkey registrieren"}
      </button>
      {error && (
        <div style={{ color: "var(--color-accent-300)", fontSize: 13 }}>{error}</div>
      )}
      <a href="/login" style={{ fontSize: 13, textAlign: "center" }}>
        Schon registriert? Anmelden
      </a>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: "var(--space-4)",
      }}
    >
      <Suspense fallback={null}>
        <RegisterForm />
      </Suspense>
    </div>
  );
}
