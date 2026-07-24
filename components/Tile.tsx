"use client";

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

/**
 * Kachel im Nocturne-Look: kleines Label, großer Wert, feine Unterzeile.
 * Ursprünglich für die Dashboard-Kacheln (req-005), seit req-009 auch für die
 * System-Kacheln der Einstellungsseite.
 */
export function Tile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="card elev-sm" style={{ gap: 2, padding: "var(--space-3)" }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          color: muted(45),
        }}
      >
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.1 }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: muted(55) }}>{sub}</div>}
    </div>
  );
}
