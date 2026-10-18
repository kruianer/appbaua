"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Repo } from "@/lib/repos";
import type { ChatMessage } from "@/lib/chat-session-store";
import { parseChatContentBlocks } from "@/lib/chat-message-blocks";
import { CopyCommand } from "./CopyCommand";

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

/**
 * Wie hoch das Eingabefeld höchstens mitwächst, bevor sein Inhalt rollt
 * (bug-030). Die genaue Grenze ist zum Ausprobieren gedacht, nicht berechnet —
 * etwa die halbe Höhe eines typischen Gesprächsbereichs.
 */
export const MAX_COMPOSER_HEIGHT_PX = 220;

/**
 * bug-034: ab welchem Abstand zum unteren Rand die Ansicht noch als "am Ende"
 * gilt. Ein kleiner Spielraum statt exakt 0, weil Scroll-Events auf Subpixel
 * genau sein können.
 */
const SCROLL_BOTTOM_THRESHOLD_PX = 24;

/**
 * "seit 2:14" statt eines stehenden Textes (bug-033 AC4): das Lebenszeichen
 * darf nicht davon abhängen, ob der Ereignisstrom (Schritte) gerade etwas zu
 * zeigen hat — eine verstrichene Zeit bewegt sich auch dann, wenn Claude
 * lange nachdenkt, ohne ein Werkzeug zu benutzen.
 */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(s / 60);
  const seconds = s % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

// req-041 AC11-13: ab 744px zweispaltig — links die Repo-Liste (ständig
// sichtbar statt der Auswahl von req-040), rechts das Gespräch, mit einer
// lesbaren Höchstbreite statt voll ausgezogenem Text. Am iPhone (split=false,
// Default) unverändert gegenüber req-040.
export function Chat({ repos, split = false }: { repos: Repo[]; split?: boolean }) {
  const [repoId, setRepoId] = useState<string>(repos[0]?.id ?? "");
  const [draft, setDraft] = useState("");
  const [messagesByRepo, setMessagesByRepo] = useState<Record<string, ChatMessage[]>>({});
  const [pendingByRepo, setPendingByRepo] = useState<Record<string, boolean>>({});
  const [stepsByRepo, setStepsByRepo] = useState<Record<string, string | null>>({});
  // bug-033 AC4: wann der aktuell laufende Zug dieses Repos begonnen hat —
  // die Grundlage für "seit 2:14" statt eines stehenden Textes.
  const [sendingSinceByRepo, setSendingSinceByRepo] = useState<Record<string, number>>({});
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  // bug-034: ob die Ansicht beim nächsten Zuwachs ans Ende rollen soll. Wer
  // nach oben gerollt hat, um Älteres zu lesen, soll nicht herausgerissen
  // werden — nur wer ohnehin am Ende steht (oder gerade selbst abgeschickt
  // hat), bleibt dort.
  const stickToBottomRef = useRef(true);

  // useMemo statt eines einfachen Ausdrucks: sonst entsteht bei jedem Render
  // eine neue Array-Referenz und der Scroll-Effekt unten (abhängig von
  // `messages`) würde ständig neu laufen.
  const messages = useMemo(() => messagesByRepo[repoId] ?? [], [messagesByRepo, repoId]);
  const sending = pendingByRepo[repoId] ?? false;
  const steps = stepsByRepo[repoId] ?? null;
  const sendingSince = sendingSinceByRepo[repoId] ?? null;

  const scrollMessagesToBottom = () => {
    const el = messagesRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  };

  const handleMessagesScroll = () => {
    const el = messagesRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceFromBottom < SCROLL_BOTTOM_THRESHOLD_PX;
  };

  // bug-034: rollt mit, solange "am Ende" gilt — bei jeder neuen Nachricht
  // UND während die Schritte (alle POLL_MS) wachsen. Hat man hochgerollt,
  // bleibt die Ansicht stehen (handleMessagesScroll setzt das Flag zurück).
  useEffect(() => {
    if (stickToBottomRef.current) scrollMessagesToBottom();
  }, [messages, steps]);

  // Beim Wechsel des Repos zeigt die Ansicht wieder das Ende seines
  // Gesprächs, nicht die zufällige Scroll-Position vom vorherigen Repo.
  useEffect(() => {
    stickToBottomRef.current = true;
  }, [repoId]);

  // bug-030: das Feld wächst mit dem Text, bis MAX_COMPOSER_HEIGHT_PX erreicht
  // ist — danach rollt sein Inhalt statt weiter zu wachsen. "auto" vor der
  // Messung wirft eine zu groß gewordene Höhe weg, sonst schrumpft das Feld
  // nie wieder, wenn Text gelöscht wird.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, MAX_COMPOSER_HEIGHT_PX);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > MAX_COMPOSER_HEIGHT_PX ? "auto" : "hidden";
  }, [draft]);

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

  // req-048: der Stand der Schritte des laufenden (oder gerade erst beendeten)
  // Zugs dieses Repos — derselbe Ereignisstrom, den der Worker schon zeigt.
  const loadSteps = async (id: string): Promise<void> => {
    try {
      const res = await fetch(`/api/chat/${id}/steps`);
      const data = (await res.json()) as { steps?: string | null };
      setStepsByRepo((prev) => ({ ...prev, [id]: data.steps ?? null }));
    } catch {
      // Nächster Tick versucht es erneut; der bisherige Stand bleibt stehen.
    }
  };

  // Solange für das GERADE OFFENE Repo eine Antwort noch läuft, fragt diese
  // Ansicht nach, bis sie da ist (AC5/AC6). Ein Wechsel zu einem anderen
  // Repo beendet nur dieses Nachfragen HIER — der Lauf selbst macht am
  // Server unabhängig weiter, und sein Ergebnis steht beim Zurückschalten
  // über den Lade-Effekt oben ohnehin bereit. Dieselbe Runde holt req-048s
  // Schritte mit, damit ihr Stand beim Zurückschalten ebenfalls aktuell ist.
  useEffect(() => {
    if (!repoId || !pendingByRepo[repoId]) return;
    const before = (messagesByRepo[repoId] ?? []).length;
    let stopped = false;
    const check = () => {
      void loadSteps(repoId);
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
    // bug-034: Abschicken gilt immer als "ans Ende" — unabhängig davon, wohin
    // zuvor hochgerollt wurde.
    stickToBottomRef.current = true;
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
    setSendingSinceByRepo((prev) => ({ ...prev, [targetRepoId]: Date.now() }));
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

  // bug-030: beendet den laufenden Lauf des offenen Repos. "ich kann SOFORT
  // weiterschreiben" heißt: wie bei send() wird gleich einmal nachgefragt,
  // statt auf den nächsten Intervall-Tick des Polling-Effekts oben zu warten
  // (der bis zu POLL_MS brauchen könnte, weil pendingByRepo sich durch den
  // Abbruch selbst nicht ändert und den Effekt deshalb nicht neu startet).
  const cancel = async () => {
    const targetRepoId = repoId;
    if (!targetRepoId) return;
    const countBefore = (messagesByRepo[targetRepoId] ?? []).length;
    try {
      await fetch(`/api/chat/${targetRepoId}/cancel`, { method: "POST" });
    } catch {
      // Das Nachfragen unten merkt das Ende des Laufs ohnehin.
    }
    const msgs = await loadMessages(targetRepoId);
    if (msgs.length > countBefore) {
      setPendingByRepo((prev) => ({ ...prev, [targetRepoId]: false }));
    }
  };

  // bug-030: Enter schickt ab, Umschalt+Enter macht einen Zeilenumbruch — ohne
  // preventDefault fügt der Browser bei Enter sonst selbst einen Umbruch ein.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const activeRepo = repos.find((r) => r.id === repoId) ?? null;

  // bug-033 AC1: der Gesprächsbereich selbst nutzt die volle Breite der
  // Spalte — die Lesebreite aus req-041 AC13 gehört an die einzelne
  // Nachricht (unten), nicht an den ganzen Bereich. AC3: ein spürbarer
  // Zuschlag am unteren Rand, damit die letzte Nachricht nicht am
  // Eingabefeld klebt.
  const messagesList = (
    <div
      data-chat-messages
      ref={messagesRef}
      onScroll={handleMessagesScroll}
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        paddingTop: split ? 16 : 0,
        paddingLeft: split ? 16 : 20,
        paddingRight: split ? 16 : 20,
        paddingBottom: split ? 28 : 24,
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
            // req-041 AC13: im Split lesbar schmal statt voll ausgezogen — ab
            // etwa 90 Zeichen je Zeile wird Lesen mühsam. Gilt für die
            // einzelne Nachricht, nicht für den ganzen Bereich (bug-033 AC1).
            maxWidth: split ? "min(760px, 88%)" : "88%",
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
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-2)",
            }}
          >
            {parseChatContentBlocks(m.content).map((block, i) =>
              block.type === "command" ? (
                <CopyCommand key={i} command={block.command} />
              ) : (
                <div key={i} style={{ whiteSpace: "pre-wrap" }}>
                  {block.text}
                </div>
              ),
            )}
          </div>
        </div>
      ))}
      {sending && (
        <>
          {/* bug-033 AC4: ein Lebenszeichen, das sich sichtbar verändert — auch
              wenn der Ereignisstrom (Schritte unten) gerade schweigt, etwa weil
              Claude lange nachdenkt. Eine verstrichene Zeit ist dafür
              belastbarer als ein stehender Text. */}
          <div data-chat-life-sign style={{ fontSize: 12, color: muted(55) }}>
            <span>Claude schreibt …</span>
            {sendingSince !== null && (
              <span> (seit {formatElapsed((Date.now() - sendingSince) / 1000)})</span>
            )}
          </div>
          {steps && (
            <div
              data-chat-steps
              style={{
                fontSize: 11.5,
                lineHeight: 1.5,
                color: muted(55),
                fontFamily: "ui-monospace, Menlo, monospace",
                whiteSpace: "pre-wrap",
                maxHeight: 160,
                overflowY: "auto",
                padding: "6px 8px",
                borderRadius: "var(--radius-md)",
                background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
              }}
            >
              {steps}
            </div>
          )}
        </>
      )}
      {/* req-048 AC4/AC5/AC8: fertig, tritt die Antwort hervor — die Schritte
          bleiben lesbar, aber eingeklappt, damit sie auf dem iPhone nicht die
          Antworten aus dem Bild drängen. */}
      {!sending && steps && (
        <details data-chat-steps style={{ fontSize: 11.5, color: muted(55) }}>
          <summary style={{ cursor: "pointer", userSelect: "none" }}>Schritte</summary>
          <div
            style={{
              whiteSpace: "pre-wrap",
              fontFamily: "ui-monospace, Menlo, monospace",
              lineHeight: 1.5,
              marginTop: 4,
              maxHeight: 160,
              overflowY: "auto",
              padding: "6px 8px",
              borderRadius: "var(--radius-md)",
              background: "color-mix(in srgb, var(--color-text) 4%, transparent)",
            }}
          >
            {steps}
          </div>
        </details>
      )}
    </div>
  );

  const composer = (
    <div
      style={{
        display: "flex",
        gap: "var(--space-2)",
        padding: split ? "12px 16px 14px" : "10px 20px 14px",
        flexShrink: 0,
        borderTop: split ? "1px solid var(--color-divider)" : undefined,
      }}
    >
      <textarea
        ref={textareaRef}
        aria-label="Nachricht"
        className="input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Nachricht an Claude…"
        rows={1}
        style={{ flex: 1, resize: "none", overflowY: "hidden" }}
      />
      <button
        className="btn btn-primary"
        aria-label={sending ? "Abbrechen" : "Senden"}
        onClick={sending ? cancel : send}
        disabled={!sending && (!draft.trim() || !repoId)}
      >
        {sending ? "Stopp" : "Senden"}
      </button>
    </div>
  );

  if (split) {
    // req-041 AC11/AC12: die Repo-Auswahl aus req-040 wird zur ständig
    // sichtbaren linken Spalte; ein Klick dort wechselt die rechte Spalte.
    return (
      <div
        style={{
          display: "flex",
          flex: 1,
          minHeight: 0,
          borderTop: "1px solid var(--color-divider)",
        }}
      >
        <div
          style={{
            flex: "none",
            width: 300,
            minWidth: 0,
            borderRight: "1px solid var(--color-divider)",
            overflowY: "auto",
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: ".12em",
              margin: "2px 4px 8px",
              color: muted(45),
            }}
          >
            Repos
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {repos.map((r) => (
              <button
                key={r.id}
                onClick={() => selectRepo(r.id)}
                aria-current={r.id === repoId}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 10px",
                  borderRadius: "var(--radius-md)",
                  cursor: "pointer",
                  border: "1px solid transparent",
                  borderColor: r.id === repoId ? "var(--color-accent)" : "transparent",
                  background:
                    r.id === repoId
                      ? "color-mix(in srgb, var(--color-accent) 12%, transparent)"
                      : "transparent",
                  textAlign: "left",
                  font: "inherit",
                  fontSize: 13.5,
                  color: r.active ? "var(--color-text)" : muted(40),
                }}
              >
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {r.name}
                </span>
              </button>
            ))}
          </div>
        </div>
        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 16px",
              borderBottom: "1px solid var(--color-divider)",
            }}
          >
            <span data-chat-active-repo style={{ fontSize: 14, fontWeight: 600 }}>
              {activeRepo?.name ?? ""}
            </span>
          </div>
          {messagesList}
          {composer}
        </div>
      </div>
    );
  }

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
      {messagesList}
      {composer}
    </div>
  );
}
