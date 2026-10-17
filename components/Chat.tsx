"use client";

import { useEffect, useState } from "react";
import type { Repo } from "@/lib/repos";

// Chat-Tab (req-040): oben die Repo-Auswahl, darunter das Gespräch mit
// Claude. Jedes Repo hat sein eigenes Gespräch. Die Auswahl merkt sich das
// zuletzt offene Repo serverseitig (req-040 AC3) — das wirkt über Geräte
// hinweg, wie der Betreiber auch von überall arbeiten will.

export function Chat({ repos }: { repos: Repo[] }) {
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const [draft, setDraft] = useState("");

  useEffect(() => {
    fetch("/api/chat/state")
      .then((r) => r.json())
      .then((d: { activeRepoId?: string | null }) => {
        if (d.activeRepoId && repos.some((r) => r.id === d.activeRepoId)) {
          setRepoId(d.activeRepoId);
        }
      })
      .catch(() => {});
    // Nur beim ersten Öffnen des Tabs laden, nicht bei jeder Änderung der
    // Repo-Liste (Hinzufügen/Entfernen eines Repos darf die Auswahl nicht
    // zurücksetzen).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectRepo = (id: string) => {
    setRepoId(id);
    void fetch("/api/chat/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: id }),
    }).catch(() => {});
  };

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
          onChange={(e) => selectRepo(e.target.value)}
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
