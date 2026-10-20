"use client";

import { useState } from "react";

// Baustein "Befehl zum Kopieren" (bug-031): ein Befehl, den der Betreiber auf
// dem Server ausführen muss, als eigenes Feld statt als Fließtext — ein
// Klick kopiert ihn. Der Text bleibt daneben sichtbar und von Hand
// markierbar, falls das Kopieren scheitert (kein sicherer Kontext, Browser
// ohne Clipboard-API) — das Feld funktioniert dann immer noch, nur ohne
// Knopf-Komfort.

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const canCopy = typeof navigator !== "undefined" && Boolean(navigator.clipboard);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Kein Rückfall nötig: der Befehl steht ohnehin selektierbar da.
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--space-2)",
        padding: "6px 10px",
        borderRadius: "var(--radius-md)",
        background: "var(--color-bg)",
        border: "1px solid var(--color-divider)",
      }}
    >
      <code
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--font-mono, monospace)",
          fontSize: 13,
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          userSelect: "all",
        }}
      >
        {command}
      </code>
      {canCopy && (
        <button
          type="button"
          className="btn"
          aria-label="Befehl kopieren"
          onClick={copy}
          style={{ flexShrink: 0, fontSize: 12, padding: "4px 8px" }}
        >
          {copied ? "Kopiert" : "Kopieren"}
        </button>
      )}
    </div>
  );
}
