"use client";

import { useState } from "react";

// req-050: das Favicon des Repos (von `main`) vor seinem Namen. Fehlt es oder
// ist die Datei kaputt (onError), steht stattdessen ein Platzhalter mit dem
// Anfangsbuchstaben — für alle Repos in derselben neutralen Farbe.
export function RepoIcon({ repoId, name, size = 18 }: { repoId: string; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size, flexShrink: 0, borderRadius: 4 } as const;
  if (failed) {
    return (
      <span
        data-repo-icon-placeholder
        aria-hidden="true"
        style={{
          ...box,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: Math.round(size * 0.6),
          fontWeight: 600,
          lineHeight: 1,
          background: "color-mix(in srgb, var(--color-text) 18%, transparent)",
          color: "var(--color-text)",
        }}
      >
        {(Array.from(name.trim())[0] ?? "?").toLocaleUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      data-repo-icon
      src={`/api/repos/${encodeURIComponent(repoId)}/favicon`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ ...box, objectFit: "contain" }}
    />
  );
}
