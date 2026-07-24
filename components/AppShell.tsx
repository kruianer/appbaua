"use client";

import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { Repo } from "@/lib/repos";
import { Icon, type IconName } from "./Icon";

type Tab = "repos" | "aktiv" | "verlauf" | "settings";

const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "repos", label: "Repos", icon: "gitbranch" },
  { key: "aktiv", label: "Aktivität", icon: "activity" },
  { key: "verlauf", label: "Verlauf", icon: "clock" },
  { key: "settings", label: "Einstellungen", icon: "settings" },
];

const PLACEHOLDER: Record<
  Exclude<Tab, "repos">,
  { icon: IconName; title: string; text: string }
> = {
  aktiv: {
    icon: "activity",
    title: "Aktivität",
    text: "Live-Aktivität des Workers — welche Datei gerade bearbeitet wird und der aktuelle Schritt. Bald verfügbar.",
  },
  verlauf: {
    icon: "clock",
    title: "Verlauf",
    text: "Abgeschlossene Läufe, Commits und Pull-Requests des Workers pro Repo. Bald verfügbar.",
  },
  settings: {
    icon: "settings",
    title: "Einstellungen",
    text: "Zugriff, Branch-Regeln und Auto-Merge-Verhalten des Workers konfigurieren. Bald verfügbar.",
  },
};

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

export function AppShell({ initialRepos }: { initialRepos: Repo[] }) {
  const [repos, setRepos] = useState<Repo[]>(initialRepos);
  const [tab, setTab] = useState<Tab>("repos");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [dispName, setDispName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const active = repos.filter((r) => r.active).length;
  const inactive = repos.length - active;
  const confirmRepo = repos.find((r) => r.id === confirmId) ?? null;

  const openSheet = useCallback(() => {
    setGitUrl("");
    setDispName("");
    setError("");
    setSheetOpen(true);
  }, []);

  const submitAdd = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/repos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: gitUrl, name: dispName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Fehler beim Hinzufügen.");
        return;
      }
      setRepos(data.repos);
      setSheetOpen(false);
      setGitUrl("");
      setDispName("");
    } catch {
      setError("Repo nicht erreichbar oder kein Zugriff.");
    } finally {
      setSubmitting(false);
    }
  }, [gitUrl, dispName, submitting]);

  const toggle = useCallback(async (id: string) => {
    // optimistic
    setRepos((prev) =>
      prev.map((r) => (r.id === id ? { ...r, active: !r.active } : r)),
    );
    const res = await fetch(`/api/repos/${id}`, { method: "PATCH" });
    if (res.ok) {
      const data = await res.json();
      setRepos(data.repos);
    }
  }, []);

  const doRemove = useCallback(async () => {
    if (!confirmId) return;
    const id = confirmId;
    setConfirmId(null);
    const res = await fetch(`/api/repos/${id}`, { method: "DELETE" });
    if (res.ok) {
      const data = await res.json();
      setRepos(data.repos);
    }
  }, [confirmId]);

  const persistOrder = useCallback(async (ordered: Repo[]) => {
    await fetch("/api/repos/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ordered.map((r) => r.id) }),
    });
  }, []);

  const startDrag = useCallback(
    (id: string, e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      setDragId(id);

      const onMove = (ev: PointerEvent) => {
        if (ev.cancelable) ev.preventDefault();
        const list = listRef.current;
        if (!list) return;
        const rows = [
          ...list.querySelectorAll<HTMLElement>("[data-repo-row]"),
        ];
        let target = rows.length - 1;
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) {
            target = i;
            break;
          }
        }
        setRepos((prev) => {
          const from = prev.findIndex((r) => r.id === id);
          if (from === -1 || from === target) return prev;
          const nextArr = [...prev];
          const [moved] = nextArr.splice(from, 1);
          nextArr.splice(target, 0, moved);
          return nextArr;
        });
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDragId(null);
        setRepos((prev) => {
          void persistOrder(prev);
          return prev;
        });
      };

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
    },
    [persistOrder],
  );

  const appStyle: CSSProperties = {
    position: "relative",
    minHeight: "100dvh",
    maxWidth: 460,
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    background: "var(--color-bg)",
    color: "var(--color-text)",
    fontFamily: "var(--font-body)",
    overflow: "hidden",
  };

  return (
    <div style={appStyle}>
      {/* App bar */}
      <div
        style={{
          padding: "12px 16px 6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            minWidth: 0,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              flex: "none",
              borderRadius: 11,
              display: "grid",
              placeItems: "center",
              color: "#fff",
              background:
                "linear-gradient(140deg, var(--color-accent-400), var(--color-accent-700))",
              boxShadow:
                "0 4px 14px color-mix(in srgb, var(--color-accent) 45%, transparent), inset 0 1px 0 color-mix(in srgb, #fff 30%, transparent)",
            }}
          >
            <Icon name="brand" size={20} />
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minWidth: 0,
              lineHeight: 1.02,
            }}
          >
            <span
              style={{
                fontWeight: 700,
                fontSize: 18,
                letterSpacing: "-.03em",
              }}
            >
              appbaua
            </span>
            <span
              style={{
                fontSize: 9,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: muted(46),
              }}
            >
              Coding-Worker
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "var(--space-2)", flex: "none" }}>
          <button
            className="btn btn-icon btn-secondary"
            aria-label="Theme wechseln"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          >
            <Icon name={theme === "dark" ? "sun" : "moon"} size={19} />
          </button>
          {tab === "repos" && (
            <button
              className="btn btn-icon btn-primary"
              aria-label="Repo hinzufügen"
              onClick={openSheet}
            >
              <Icon name="plus" size={20} />
            </button>
          )}
        </div>
      </div>

      {/* Module title */}
      <div style={{ padding: "6px 20px 10px", minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            color: "var(--color-accent-300)",
            marginBottom: 2,
          }}
        >
          Modul
        </div>
        <h2 style={{ margin: 0, fontSize: 28, letterSpacing: "-.02em" }}>
          {tab === "repos" ? "Repo-Verwaltung" : PLACEHOLDER[tab].title}
        </h2>
        {tab === "repos" && (
          <div style={{ fontSize: 13, color: muted(55), marginTop: 3 }}>
            Der Worker arbeitet die Liste von oben nach unten ab.
          </div>
        )}
      </div>

      {tab === "repos" ? (
        <>
          {/* Worker status card (idle — worker not running for appbaua itself) */}
          <div
            className="card elev-md"
            style={{
              margin: "0 20px 12px",
              gap: "var(--space-2)",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)), var(--color-surface))",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: ".14em",
                  textTransform: "uppercase",
                  color: "var(--color-accent-300)",
                }}
              >
                Worker
              </span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 11,
                  color: "var(--color-accent-300)",
                  border: "1px solid var(--color-accent)",
                  padding: "2px 9px",
                  borderRadius: 999,
                }}
              >
                <span
                  style={{
                    width: 7,
                    height: 7,
                    borderRadius: 999,
                    flex: "none",
                    background: muted(35),
                  }}
                />
                Leerlauf
              </span>
            </div>
            <div style={{ fontSize: 15, lineHeight: 1.3, color: muted(65) }}>
              im Leerlauf — keine aktiven Repos
            </div>
            <div
              style={{
                display: "flex",
                gap: "var(--space-4)",
                fontSize: 12,
                color: muted(60),
                marginTop: 2,
              }}
            >
              <span>
                <strong style={{ color: "var(--color-text)" }}>{active}</strong>{" "}
                aktiv
              </span>
              <span>
                <strong style={{ color: "var(--color-text)" }}>
                  {inactive}
                </strong>{" "}
                inaktiv
              </span>
              <span>
                <strong style={{ color: "var(--color-text)" }}>
                  {repos.length}
                </strong>{" "}
                gesamt
              </span>
            </div>
          </div>

          {/* List / empty state */}
          <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
            {repos.length > 0 ? (
              <>
                <div
                  style={{
                    fontSize: 10,
                    letterSpacing: ".12em",
                    textTransform: "uppercase",
                    color: muted(45),
                    margin: "2px 0 var(--space-2)",
                  }}
                >
                  Priorität · 1 = höchste
                </div>
                <div
                  ref={listRef}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                  }}
                >
                  {repos.map((r, i) => {
                    const dragging = r.id === dragId;
                    const first = i === 0;
                    return (
                      <div
                        key={r.id}
                        data-repo-row
                        data-id={r.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "var(--space-3)",
                          padding: "var(--space-3)",
                          background: "var(--color-surface)",
                          borderRadius: "var(--radius-md)",
                          boxShadow: dragging
                            ? "var(--shadow-lg)"
                            : "var(--shadow-sm)",
                          opacity: r.active ? 1 : 0.5,
                          transform: dragging ? "scale(1.02)" : "none",
                          position: "relative",
                          zIndex: dragging ? 5 : 1,
                          transition:
                            "box-shadow .15s ease, transform .12s ease",
                        }}
                      >
                        <div
                          onPointerDown={(e) => startDrag(r.id, e)}
                          aria-label="Ziehen zum Umsortieren"
                          style={{
                            flex: "none",
                            display: "grid",
                            placeItems: "center",
                            width: 30,
                            height: 46,
                            cursor: "grab",
                            touchAction: "none",
                            color: muted(42),
                          }}
                        >
                          <Icon name="grip" size={22} />
                        </div>
                        <div
                          style={{
                            flex: "none",
                            width: 26,
                            height: 26,
                            display: "grid",
                            placeItems: "center",
                            borderRadius: 999,
                            fontWeight: 600,
                            fontSize: 13,
                            background: first
                              ? "var(--color-accent)"
                              : "color-mix(in srgb, var(--color-text) 10%, transparent)",
                            color: first
                              ? "var(--color-bg)"
                              : "var(--color-text)",
                          }}
                        >
                          {i + 1}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontWeight: 600,
                              fontSize: 16,
                              lineHeight: 1.2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {r.name}
                          </div>
                          <div
                            style={{
                              fontSize: 12,
                              color: muted(52),
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {r.url}
                          </div>
                        </div>
                        <button
                          role="switch"
                          aria-checked={r.active}
                          aria-label={`${r.name} aktiv/inaktiv`}
                          onClick={() => toggle(r.id)}
                          style={{
                            flex: "none",
                            width: 46,
                            height: 28,
                            borderRadius: 999,
                            border: "none",
                            padding: 3,
                            display: "flex",
                            cursor: "pointer",
                            justifyContent: r.active
                              ? "flex-end"
                              : "flex-start",
                            background: r.active
                              ? "var(--color-accent)"
                              : "color-mix(in srgb, var(--color-text) 22%, transparent)",
                            transition: "background .15s ease",
                          }}
                        >
                          <span
                            style={{
                              width: 22,
                              height: 22,
                              borderRadius: 999,
                              background: "var(--color-bg)",
                              boxShadow: "0 1px 2px rgba(0,0,0,.4)",
                            }}
                          />
                        </button>
                        <button
                          className="btn btn-icon btn-ghost"
                          aria-label={`${r.name} entfernen`}
                          onClick={() => setConfirmId(r.id)}
                          style={{ flex: "none" }}
                        >
                          <Icon name="trash" size={18} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  textAlign: "center",
                  gap: "var(--space-3)",
                  padding: "var(--space-8) var(--space-4)",
                  marginTop: "var(--space-6)",
                }}
              >
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 999,
                    display: "grid",
                    placeItems: "center",
                    color: "var(--color-accent-300)",
                    border: "1px solid var(--color-accent)",
                  }}
                >
                  <Icon name="folder" size={28} />
                </div>
                <div>
                  <h4 style={{ margin: "0 0 4px" }}>Noch keine Repos</h4>
                  <p style={{ margin: 0, fontSize: 14, color: muted(60) }}>
                    Füge dein erstes hinzu — der Worker legt damit los.
                  </p>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={openSheet}
                  style={{ marginTop: "var(--space-2)" }}
                >
                  <Icon name="plus" size={17} /> Repo hinzufügen
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            gap: "var(--space-3)",
            padding: "var(--space-8)",
          }}
        >
          <div
            style={{
              width: 66,
              height: 66,
              borderRadius: 999,
              display: "grid",
              placeItems: "center",
              color: "var(--color-accent-300)",
              border: "1px solid var(--color-accent)",
            }}
          >
            <Icon name={PLACEHOLDER[tab].icon} size={30} />
          </div>
          <h3 style={{ margin: 0 }}>{PLACEHOLDER[tab].title}</h3>
          <p style={{ margin: 0, fontSize: 14, maxWidth: 240, color: muted(60) }}>
            {PLACEHOLDER[tab].text}
          </p>
        </div>
      )}

      {/* Bottom tab bar */}
      <div
        style={{
          flex: "none",
          position: "relative",
          display: "flex",
          justifyContent: "space-around",
          padding: "10px 8px 30px",
          background: "var(--color-bg)",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: 1,
            background:
              "linear-gradient(to right, transparent, var(--color-divider) 48px, var(--color-divider) calc(100% - 48px), transparent)",
          }}
        />
        {TABS.map((t) => (
          <button
            key={t.key}
            aria-label={t.label}
            onClick={() => setTab(t.key)}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
              color:
                tab === t.key ? "var(--color-accent)" : muted(48),
            }}
          >
            <Icon name={t.icon} size={23} />
            <span style={{ fontSize: 10, letterSpacing: ".01em" }}>
              {t.label}
            </span>
          </button>
        ))}
      </div>

      {/* Add sheet */}
      {sheetOpen && (
        <div
          onClick={() => setSheetOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 40,
            display: "flex",
            alignItems: "flex-end",
            justifyContent: "center",
            background: "color-mix(in srgb, #000 55%, transparent)",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "100%",
              maxWidth: 460,
              background: "var(--color-surface)",
              borderRadius: "var(--radius-lg) var(--radius-lg) 0 0",
              padding: "var(--space-4) var(--space-4) 34px",
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <h4 style={{ margin: 0 }}>Repo hinzufügen</h4>
              <button
                className="btn btn-icon btn-ghost"
                aria-label="Schließen"
                onClick={() => setSheetOpen(false)}
              >
                <Icon name="x" size={20} />
              </button>
            </div>
            <div className="field">
              <label htmlFor="giturl">Git-URL *</label>
              <input
                id="giturl"
                className="input"
                placeholder="github.com/kruianer/mein-repo"
                value={gitUrl}
                onChange={(e) => setGitUrl(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="dispname">Anzeigename (optional)</label>
              <input
                id="dispname"
                className="input"
                placeholder="mein-repo"
                value={dispName}
                onChange={(e) => setDispName(e.target.value)}
              />
            </div>
            {error && (
              <div
                role="alert"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  padding: "9px 12px",
                  borderRadius: "var(--radius-md)",
                  color: "var(--color-accent-300)",
                  border: "1px solid var(--color-accent)",
                  background: "color-mix(in srgb, var(--color-accent) 14%, transparent)",
                }}
              >
                <Icon name="warning" size={17} />
                <span>{error}</span>
              </div>
            )}
            <button
              className="btn btn-primary btn-block"
              onClick={submitAdd}
              disabled={submitting}
            >
              <Icon name="plus" size={16} /> Hinzufügen
            </button>
          </div>
        </div>
      )}

      {/* Remove confirm dialog */}
      {confirmRepo && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "grid",
            placeItems: "center",
            padding: "var(--space-4)",
            background: "color-mix(in srgb, #000 55%, transparent)",
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            style={{
              width: "100%",
              maxWidth: 320,
              background: "var(--color-surface)",
              borderRadius: "var(--radius-lg)",
              padding: "var(--space-4)",
              boxShadow: "var(--shadow-lg)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <h4 style={{ margin: 0 }}>Repo entfernen?</h4>
            <p style={{ margin: 0, fontSize: 14, color: muted(75) }}>
              Repo <strong>{confirmRepo.name}</strong> wirklich entfernen? Das
              lässt sich nicht rückgängig machen.
            </p>
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "var(--space-2)",
                marginTop: "var(--space-2)",
              }}
            >
              <button
                className="btn btn-secondary"
                onClick={() => setConfirmId(null)}
              >
                Abbrechen
              </button>
              <button className="btn btn-primary" onClick={doRemove}>
                <Icon name="trash" size={16} /> Entfernen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
