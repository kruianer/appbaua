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
import type { TaskType } from "@/lib/task-types";
import type { GithubRepo } from "@/lib/github-repos";
import { Icon, type IconName } from "./Icon";
import { TaskControl } from "./TaskControl";
import { RunLog } from "./RunLog";
import { Settings } from "./Settings";
import { WorkerDashboard } from "./WorkerDashboard";

type Tab = "aktiv" | "verlauf" | "repos" | "settings" | "einstellungen";

// Aktivität is the start view and the first nav entry (req-005).
// Order: Aktivität, Verlauf, Repos, Tasks, Einstellungen (req-007).
// The "settings" key is the Tasks tab (historical); "einstellungen" is the
// Einstellungsseite and owns the cog icon, so Tasks shows a list icon.
const TABS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "aktiv", label: "Aktivität", icon: "activity" },
  { key: "verlauf", label: "Verlauf", icon: "clock" },
  { key: "repos", label: "Repos", icon: "gitbranch" },
  { key: "settings", label: "Tasks", icon: "list" },
  { key: "einstellungen", label: "Einstellungen", icon: "settings" },
];

const MODULE_TITLE: Record<Tab, string> = {
  aktiv: "Aktivität",
  verlauf: "Verlauf",
  repos: "Repo-Verwaltung",
  settings: "Task-Steuerung",
  einstellungen: "Einstellungen",
};

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

export function AppShell({
  initialRepos,
  initialTaskTypes,
  initialWorkerEnabled,
}: {
  initialRepos: Repo[];
  initialTaskTypes: TaskType[];
  initialWorkerEnabled: boolean;
}) {
  const [repos, setRepos] = useState<Repo[]>(initialRepos);
  const [tab, setTab] = useState<Tab>("aktiv");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [gitUrl, setGitUrl] = useState("");
  const [dispName, setDispName] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [ghRepos, setGhRepos] = useState<GithubRepo[]>([]);
  const [ghLoading, setGhLoading] = useState(false);
  // req-012: which repo is currently being converted, and the last result per
  // repo (success summary or error) shown right at its entry.
  const [converting, setConverting] = useState<string | null>(null);
  const [convertResult, setConvertResult] = useState<
    Record<string, { ok: boolean; text: string }>
  >({});

  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const confirmRepo = repos.find((r) => r.id === confirmId) ?? null;

  const openSheet = useCallback(() => {
    setGitUrl("");
    setDispName("");
    setError("");
    setSheetOpen(true);
    // Load the account's repos for the dropdown (best-effort).
    setGhLoading(true);
    fetch("/api/github-repos")
      .then((r) => r.json())
      .then((d) => setGhRepos(d.repos ?? []))
      .catch(() => setGhRepos([]))
      .finally(() => setGhLoading(false));
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

  // Roll the appbaua standard out into one repo (req-012). One at a time: the
  // rollouts share work directories server-side, and the entry has to stay
  // readable while it runs.
  const convert = useCallback(
    async (id: string) => {
      if (converting) return;
      setConverting(id);
      setConvertResult((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      try {
        const res = await fetch(`/api/repos/${id}/appbaua`, { method: "POST" });
        const data = await res.json().catch(() => ({}));
        setConvertResult((prev) => ({
          ...prev,
          [id]: res.ok
            ? { ok: true, text: data.message ?? "Umstellung abgeschlossen." }
            : { ok: false, text: data.error ?? "Umstellung fehlgeschlagen." },
        }));
      } catch {
        setConvertResult((prev) => ({
          ...prev,
          [id]: {
            ok: false,
            text: "Umstellung fehlgeschlagen — Zielrepo nicht erreichbar?",
          },
        }));
      } finally {
        setConverting(null);
      }
    },
    [converting],
  );

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
    height: "100dvh", // fixed viewport height: header/footer stay put, middle scrolls
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
      {/* App bar — its accent tint lives in nocturne.css (.app-bar), the app's
          source of truth for the look (req-015). */}
      <div
        className="app-bar"
        data-app-bar
        style={{
          flexShrink: 0,
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
          {/* Free-standing line logo — no tile, no box (req-015). */}
          <div
            data-logo
            style={{
              flex: "none",
              display: "grid",
              placeItems: "center",
              color: "var(--color-accent)",
            }}
          >
            <Icon name="brand" size={30} sw={1.6} />
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
      <div style={{ flexShrink: 0, padding: "6px 20px 10px", minWidth: 0 }}>
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
          {MODULE_TITLE[tab]}
        </h2>
        {tab === "aktiv" && (
          <div style={{ fontSize: 13, color: muted(55), marginTop: 3 }}>
            Was der Worker gerade tut.
          </div>
        )}
        {tab === "repos" && (
          <div style={{ fontSize: 13, color: muted(55), marginTop: 3 }}>
            Der Worker arbeitet die Liste von oben nach unten ab.
          </div>
        )}
        {tab === "settings" && (
          <div style={{ fontSize: 13, color: muted(55), marginTop: 3 }}>
            Priorität und Zeiten je Task-Typ — gilt für alle Repos.
          </div>
        )}
        {tab === "einstellungen" && (
          <div style={{ fontSize: 13, color: muted(55), marginTop: 3 }}>
            Wartung und Optionen der App.
          </div>
        )}
      </div>

      {tab === "aktiv" ? (
        <WorkerDashboard />
      ) : tab === "repos" ? (
        <>
          {/* List / empty state (Repo-Verwaltung only, no dashboard) */}
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
                    const busy = r.id === converting;
                    const result = convertResult[r.id];
                    return (
                      <div
                        key={r.id}
                        data-repo-row
                        data-id={r.id}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          // The appbaua row below wraps onto its own line.
                          flexWrap: "wrap",
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
                        {/* req-012: bring this repo up to the appbaua standard.
                            Own line, so the entry above stays readable. */}
                        <div
                          style={{
                            flexBasis: "100%",
                            minWidth: 0,
                            display: "flex",
                            alignItems: "center",
                            flexWrap: "wrap",
                            gap: "var(--space-2)",
                          }}
                        >
                          <button
                            className="btn btn-secondary"
                            aria-label={`${r.name} auf appbaua umstellen`}
                            onClick={() => convert(r.id)}
                            disabled={converting !== null}
                            style={{
                              flex: "none",
                              fontSize: 12,
                              padding: "6px 10px",
                            }}
                          >
                            <Icon name="sync" size={15} />
                            {busy ? "Wird umgestellt …" : "Auf appbaua umstellen"}
                          </button>
                          {result && (
                            <span
                              role="status"
                              style={{
                                // Beside the button while it fits, on its own
                                // line as soon as it does not.
                                flex: "1 1 160px",
                                minWidth: 0,
                                fontSize: 12,
                                lineHeight: 1.35,
                                wordBreak: "break-word",
                                color: result.ok
                                  ? muted(70)
                                  : "var(--color-accent-300)",
                              }}
                            >
                              {result.text}
                            </span>
                          )}
                        </div>
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
      ) : tab === "settings" ? (
        <TaskControl
          initialTaskTypes={initialTaskTypes}
          initialWorkerEnabled={initialWorkerEnabled}
        />
      ) : tab === "einstellungen" ? (
        <Settings />
      ) : (
        <RunLog />
      )}

      {/* Bottom tab bar */}
      <nav
        aria-label="Hauptnavigation"
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
            <span
              style={{
                fontSize: 10,
                letterSpacing: ".01em",
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
            </span>
          </button>
        ))}
      </nav>

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
              <label htmlFor="ghselect">
                Aus deinen GitHub-Repos wählen
              </label>
              <select
                id="ghselect"
                className="input"
                value=""
                disabled={ghLoading || ghRepos.length === 0}
                onChange={(e) => {
                  if (e.target.value) setGitUrl(e.target.value);
                }}
              >
                <option value="">
                  {ghLoading
                    ? "lädt…"
                    : ghRepos.length === 0
                      ? "keine Repos gefunden (Token?)"
                      : "— Repo wählen —"}
                </option>
                {ghRepos
                  .filter((g) => !repos.some((r) => r.url === g.url))
                  .map((g) => (
                    <option key={g.url} value={g.url}>
                      {g.fullName}
                    </option>
                  ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="giturl">…oder Git-URL eingeben *</label>
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
