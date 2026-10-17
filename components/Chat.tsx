"use client";

import { useEffect, useState } from "react";
import type { Repo } from "@/lib/repos";
import type { ChatMessage } from "@/lib/chat-session-store";

// Chat-Tab (req-040): oben die Repo-Auswahl, darunter das Gespräch mit
// Claude. Jedes Repo hat sein eigenes Gespräch. Die Auswahl merkt sich das
// zuletzt offene Repo serverseitig (AC3) — das wirkt über Geräte hinweg, wie
// der Betreiber auch von überall arbeiten will.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "Ich",
  assistant: "Claude",
  system: "System",
};

export function Chat({ repos }: { repos: Repo[] }) {
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);

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

  useEffect(() => {
    if (!repoId) {
      setMessages([]);
      return;
    }
    fetch(`/api/chat/${repoId}/messages`)
      .then((r) => r.json())
      .then((d: { messages?: ChatMessage[] }) => setMessages(d.messages ?? []))
      .catch(() => {});
  }, [repoId]);

  const selectRepo = (id: string) => {
    setRepoId(id);
    void fetch("/api/chat/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ repoId: id }),
    }).catch(() => {});
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || !repoId || sending) return;
    setDraft("");
    setSending(true);
    try {
      const res = await fetch(`/api/chat/${repoId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      const data = (await res.json()) as { messages?: ChatMessage[] };
      if (data.messages) setMessages(data.messages);
    } finally {
      setSending(false);
    }
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
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "0 20px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        {messages.map((m) => (
          <div
            key={m.id}
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignSelf: m.role === "user" ? "flex-end" : "stretch",
              maxWidth: "88%",
            }}
          >
            <div style={{ fontSize: 10, color: muted(50) }}>{ROLE_LABEL[m.role]}</div>
            <div
              style={{
                padding: "8px 10px",
                borderRadius: "var(--radius-md)",
                background:
                  m.role === "user"
                    ? "var(--color-accent)"
                    : m.role === "system"
                      ? "color-mix(in srgb, var(--color-accent) 14%, transparent)"
                      : "var(--color-surface)",
                color: m.role === "user" ? "var(--color-bg)" : "var(--color-text)",
                fontSize: 14,
                lineHeight: 1.4,
                whiteSpace: "pre-wrap",
              }}
            >
              {m.content}
            </div>
          </div>
        ))}
      </div>
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
          onClick={send}
          disabled={!draft.trim() || !repoId || sending}
        >
          {sending ? "…" : "Senden"}
        </button>
      </div>
    </div>
  );
}
