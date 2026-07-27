// The one-time plaintext view of a freshly issued backup-code set. Shared by
// the registration flow (req-023) and the settings' "neu erzeugen" action
// (req-031), so both show the SAME presentation — there is exactly one place
// that renders plaintext codes.

export function BackupCodesDisplay({
  codes,
  onDismiss,
  dismissLabel = "Gesichert — weiter",
}: {
  codes: string[];
  onDismiss: () => void;
  dismissLabel?: string;
}) {
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
        {codes.map((c) => (
          <div key={c}>{c}</div>
        ))}
      </div>
      <button className="btn btn-primary btn-block" onClick={onDismiss}>
        {dismissLabel}
      </button>
    </div>
  );
}
