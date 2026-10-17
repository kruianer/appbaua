"use client";

import { useEffect, useState } from "react";
import type { Repo } from "@/lib/repos";
import type { ChatMessage } from "@/lib/chat-session-store";

// Chat-Tab (req-040): oben die Repo-Auswahl, darunter das Gespräch mit
// Claude. Jedes Repo hat sein eigenes Gespräch UND seine eigene Claude-
// Sitzung (AC4/AC7/AC15, siehe lib/chat-session-manager.ts). Der Versand
// läuft serverseitig unabhängig vom gerade offenen Repo weiter (AC5/AC6):
// `messagesByRepo`/`pendingByRepo` sind deshalb pro Repo geführt, nicht ein
// einziger geteilter Zustand — sonst würde das Senden in einem Repo die
// Eingabe in einem anderen blockieren.

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const ROLE_LABEL: Record<ChatMessage["role"], string> = {
  user: "Ich",
  assistant: "Claude",
  system: "System",
};

/** Wie oft nachgefragt wird, solange eine Antwort für das offene Repo noch läuft. */
export const POLL_MS = 1500;

export function Chat({ repos }: { repos: Repo[] }) {
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [messagesByRepo, setMessagesByRepo] = useState<Record<string, ChatMessage[]>>({});
  const [pendingByRepo, setPendingByRepo] = useState<Record<string, boolean>>({});

  const messages = messagesByRepo[repoId] ?? [];
  const sending = pendingByRepo[repoId] ?? false;

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

  const loadMessages = async (id: string): Promise<ChatMessage[]> => {
    try {
      const res = await fetch(`/api/chat/${id}/messages`);
      const data = (await res.json()) as { messages?: ChatMessage[] };
      const msgs = data.messages ?? [];
      setMessagesByRepo((prev) => ({ ...prev, [id]: msgs }));
      return msgs;
    } catch {
      return messagesByRepo[id] ?? [];
    }
  };

  useEffect(() => {
    if (!repoId) return;
    void loadMessages(repoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId]);

  // Solange für das GERADE OFFENE Repo eine Antwort noch läuft, fragt diese
  // Ansicht nach, bis sie da ist (AC5/AC6). Ein Wechsel zu einem anderen
  // Repo beendet nur dieses Nachfragen HIER — der Lauf selbst macht am
  // Server unabhängig weiter, und sein Ergebnis steht beim Zurückschalten
  // über den Lade-Effekt oben ohnehin bereit.
  useEffect(() => {
    if (!repoId || !pendingByRepo[repoId]) return;
    const before = (messagesByRepo[repoId] ?? []).length;
    let stopped = false;
    const check = () => {
      void loadMessages(repoId).then((msgs) => {
        if (!stopped && msgs.length > before) {
          setPendingByRepo((prev) => ({ ...prev, [repoId]: false }));
        }
      });
    };
    check(); // gleich einmal nachfragen, nicht erst nach POLL_MS warten
    const timer = setInterval(check, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoId, pendingByRepo[repoId]]);

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
    const targetRepoId = repoId;
    if (!content || !targetRepoId || pendingByRepo[targetRepoId]) return;
    setDraft("");
    const countBeforeSend = (messagesByRepo[targetRepoId] ?? []).length + 1; // +1: die Nachricht selbst
    const optimistic: ChatMessage = {
      id: -Date.now(),
      repoId: targetRepoId,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessagesByRepo((prev) => ({
      ...prev,
      [targetRepoId]: [...(prev[targetRepoId] ?? []), optimistic],
    }));
    setPendingByRepo((prev) => ({ ...prev, [targetRepoId]: true }));
    try {
      await fetch(`/api/chat/${targetRepoId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
    } catch {
      // Das Nachfragen unten holt die Antwort trotzdem, sobald sie da ist.
    }
    // Gleich einmal nachfragen: läuft Claude schnell (oder lief die Antwort
    // schon, bevor diese Anfrage überhaupt ankam), steht sie damit sofort da,
    // statt erst auf den nächsten Intervall-Tick des Effekts unten zu warten.
    const msgs = await loadMessages(targetRepoId);
    if (msgs.length > countBeforeSend) {
      setPendingByRepo((prev) => ({ ...prev, [targetRepoId]: false }));
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
        {sending && (
          <div style={{ fontSize: 12, color: muted(55) }}>Claude schreibt …</div>
        )}
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
