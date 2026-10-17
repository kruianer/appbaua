"use client";

import { useState } from "react";
import type { Repo } from "@/lib/repos";

// Chat-Tab (req-040): oben die Repo-Auswahl, darunter das Gespräch mit
// Claude. Jedes Repo hat sein eigenes Gespräch — das folgt mit den nächsten
// Etappen dieses Requirements; diese Etappe liefert erst einmal die Ansicht
// selbst: Auswahl (auch inaktive Repos, der Worker-Status spielt hier keine
// Rolle) und ein leeres Eingabefeld.

export function Chat({ repos }: { repos: Repo[] }) {
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const [draft, setDraft] = useState("");

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
      }}
    >
      <div style={{ padding: "0 20px 10px", flexShrink: 0 }}>
        <select
          aria-label="Repo"
          className="input"
          value={repoId}
          onChange={(e) => setRepoId(e.target.value)}
        >
          {repos.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
      </div>
      <div
        data-chat-messages
        style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}
      />
      <div
        style={{
          display: "flex",
          gap: "var(--space-2)",
          padding: "10px 20px 14px",
          flexShrink: 0,
        }}
      >
        <textarea
          aria-label="Nachricht"
          className="input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Nachricht an Claude…"
          rows={1}
          style={{ flex: 1, resize: "none" }}
        />
        <button
          className="btn btn-primary"
          aria-label="Senden"
          disabled={!draft.trim() || !repoId}
        >
          Senden
        </button>
      </div>
    </div>
  );
}
