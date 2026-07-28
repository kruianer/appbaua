"use client";

import {
  type CSSProperties,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
  useCallback,
  useRef,
  useState,
} from "react";
import {
  type DaySchedule,
  type TaskType,
  type Weekday,
  WEEKDAYS,
  WEEKDAY_LABELS,
  prefillDay,
  runsAlways,
} from "@/lib/task-types";
import { Icon } from "./Icon";

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

const DAY_SHORT: Record<Weekday, string> = {
  mon: "Mo",
  tue: "Di",
  wed: "Mi",
  thu: "Do",
  fri: "Fr",
  sat: "Sa",
  sun: "So",
};

export function TaskControl({
  types,
  setTypes,
  workerEnabled,
  setWorkerEnabled,
}: {
  types: TaskType[];
  setTypes: Dispatch<SetStateAction<TaskType[]>>;
  workerEnabled: boolean;
  setWorkerEnabled: Dispatch<SetStateAction<boolean>>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [dayErrors, setDayErrors] = useState<Record<string, string>>({});
  const listRef = useRef<HTMLDivElement | null>(null);

  const toggleWorker = useCallback(async () => {
    const next = !workerEnabled;
    setWorkerEnabled(next); // optimistic
    const res = await fetch("/api/worker-state", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
    if (res.ok) setWorkerEnabled((await res.json()).state.enabled);
  }, [workerEnabled]);

  const persistOrder = useCallback(async (ordered: TaskType[]) => {
    await fetch("/api/task-types/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: ordered.map((t) => t.id) }),
    });
  }, []);

  const toggle = useCallback(async (id: string) => {
    setTypes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, active: !t.active } : t)),
    );
    const res = await fetch(`/api/task-types/${id}`, { method: "PATCH" });
    if (res.ok) setTypes((await res.json()).types);
  }, []);

  const toggleAlways = useCallback(async (id: string) => {
    setTypes((prev) =>
      prev.map((t) => (t.id === id ? { ...t, always: !t.always } : t)),
    );
    const res = await fetch(`/api/task-types/${id}/always`, {
      method: "PATCH",
    });
    if (res.ok) setTypes((await res.json()).types);
  }, []);

  const saveDay = useCallback(
    async (id: string, day: Weekday, value: DaySchedule) => {
      const res = await fetch(`/api/task-types/${id}/schedule`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, ...value }),
      });
      const data = await res.json();
      const key = `${id}:${day}`;
      if (!res.ok) {
        setDayErrors((e) => ({ ...e, [key]: data.error }));
        return;
      }
      setDayErrors((e) => {
        const next = { ...e };
        delete next[key];
        return next;
      });
      setTypes(data.types);
    },
    [],
  );

  const startDrag = useCallback(
    (id: string, e: ReactPointerEvent) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      e.preventDefault();
      setDragId(id);
      setOpenId(null); // collapse while reordering

      const onMove = (ev: PointerEvent) => {
        if (ev.cancelable) ev.preventDefault();
        const list = listRef.current;
        if (!list) return;
        const rows = [
          ...list.querySelectorAll<HTMLElement>("[data-task-row]"),
        ];
        let target = rows.length - 1;
        for (let i = 0; i < rows.length; i++) {
          const rect = rows[i].getBoundingClientRect();
          if (ev.clientY < rect.top + rect.height / 2) {
            target = i;
            break;
          }
        }
        setTypes((prev) => {
          const from = prev.findIndex((t) => t.id === id);
          if (from === -1 || from === target) return prev;
          const next = [...prev];
          const [moved] = next.splice(from, 1);
          next.splice(target, 0, moved);
          return next;
        });
      };

      const onUp = () => {
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        setDragId(null);
        setTypes((prev) => {
          void persistOrder(prev);
          return prev;
        });
      };

      document.addEventListener("pointermove", onMove, { passive: false });
      document.addEventListener("pointerup", onUp);
    },
    [persistOrder],
  );

  return (
    <div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
      {/* Global worker main switch (req-003) */}
      <div
        className="card elev-md"
        style={{
          margin: "2px 0 12px",
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
          background: workerEnabled
            ? "linear-gradient(180deg, color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)), var(--color-surface))"
            : "var(--color-surface)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "var(--color-accent-300)",
            }}
          >
            Worker
          </div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>
            {workerEnabled ? "läuft nach den Einstellungen" : "gestoppt"}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={workerEnabled}
          aria-label="Worker an/aus"
          onClick={toggleWorker}
          style={{
            flex: "none",
            width: 52,
            height: 30,
            borderRadius: 999,
            border: "none",
            padding: 3,
            display: "flex",
            cursor: "pointer",
            justifyContent: workerEnabled ? "flex-end" : "flex-start",
            background: workerEnabled
              ? "var(--color-accent)"
              : "color-mix(in srgb, var(--color-text) 22%, transparent)",
            transition: "background .15s ease",
          }}
        >
          <span
            style={{
              width: 24,
              height: 24,
              borderRadius: 999,
              background: "var(--color-bg)",
              boxShadow: "0 1px 2px rgba(0,0,0,.4)",
            }}
          />
        </button>
      </div>

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
        {types.map((t, i) => {
          const dragging = t.id === dragId;
          const first = i === 0;
          const open = openId === t.id;
          const rowStyle: CSSProperties = {
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-2)",
            padding: "var(--space-3)",
            background: "var(--color-surface)",
            borderRadius: "var(--radius-md)",
            boxShadow: dragging ? "var(--shadow-lg)" : "var(--shadow-sm)",
            opacity: t.active ? 1 : 0.5,
            transform: dragging ? "scale(1.02)" : "none",
            position: "relative",
            zIndex: dragging ? 5 : 1,
            transition: "box-shadow .15s ease, transform .12s ease",
          };

          return (
            <div key={t.id} data-task-row data-id={t.id} style={rowStyle}>
              {/* header row */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                }}
              >
                <div
                  onPointerDown={(e) => startDrag(t.id, e)}
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
                    color: first ? "var(--color-bg)" : "var(--color-text)",
                  }}
                >
                  {i + 1}
                </div>
                <button
                  onClick={() => setOpenId(open ? null : t.id)}
                  aria-expanded={open}
                  style={{
                    minWidth: 0,
                    flex: 1,
                    textAlign: "left",
                    background: "transparent",
                    border: "none",
                    color: "var(--color-text)",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  <div
                    style={{
                      fontWeight: 600,
                      fontSize: 16,
                      lineHeight: 1.2,
                    }}
                  >
                    {t.label}
                  </div>
                  <div style={{ fontSize: 12, color: muted(52) }}>
                    {scheduleSummary(t)}
                  </div>
                </button>
                <button
                  role="switch"
                  aria-checked={t.active}
                  aria-label={`${t.label} aktiv/inaktiv`}
                  onClick={() => toggle(t.id)}
                  style={{
                    flex: "none",
                    width: 46,
                    height: 28,
                    borderRadius: 999,
                    border: "none",
                    padding: 3,
                    display: "flex",
                    cursor: "pointer",
                    justifyContent: t.active ? "flex-end" : "flex-start",
                    background: t.active
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
              </div>

              {/* expanded: immer-switch + (unless always) the 7-day schedule */}
              {open && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "var(--space-2)",
                    paddingTop: "var(--space-2)",
                    borderTop: `1px solid ${muted(12)}`,
                  }}
                >
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={t.always}
                      aria-label={`${t.label} immer`}
                      onChange={() => toggleAlways(t.id)}
                    />
                    <span>
                      immer{" "}
                      <span style={{ color: muted(50) }}>
                        (rund um die Uhr, keine Wochentage)
                      </span>
                    </span>
                  </label>

                  {!t.always &&
                    WEEKDAYS.map((day) => {
                      const ds = t.schedule[day];
                      const key = `${t.id}:${day}`;
                      const err = dayErrors[key];
                      return (
                        <div
                          key={day}
                          style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: 4,
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "var(--space-2)",
                            }}
                          >
                            <label
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                width: 92,
                                flex: "none",
                                fontSize: 13,
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={ds.enabled}
                                aria-label={WEEKDAY_LABELS[day]}
                                onChange={(e) =>
                                  saveDay(
                                    t.id,
                                    day,
                                    prefillDay({
                                      ...ds,
                                      enabled: e.target.checked,
                                    }),
                                  )
                                }
                              />
                              {DAY_SHORT[day]}
                            </label>
                            <input
                              type="time"
                              className="input"
                              aria-label={`${WEEKDAY_LABELS[day]} von`}
                              value={ds.start ?? ""}
                              disabled={!ds.enabled}
                              onChange={(e) =>
                                saveDay(t.id, day, {
                                  ...ds,
                                  start: e.target.value || null,
                                })
                              }
                              style={{ flex: 1, minWidth: 0 }}
                            />
                            <span style={{ color: muted(50) }}>–</span>
                            <input
                              type="time"
                              className="input"
                              aria-label={`${WEEKDAY_LABELS[day]} bis`}
                              value={ds.end ?? ""}
                              disabled={!ds.enabled}
                              onChange={(e) =>
                                saveDay(t.id, day, {
                                  ...ds,
                                  end: e.target.value || null,
                                })
                              }
                              style={{ flex: 1, minWidth: 0 }}
                            />
                          </div>
                          {err && (
                            <div
                              role="alert"
                              style={{
                                fontSize: 12,
                                fontWeight: 600,
                                color: "var(--color-accent-300)",
                              }}
                            >
                              {err}
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function scheduleSummary(t: TaskType): string {
  if (!t.active) return "inaktiv";
  if (runsAlways(t)) return "läuft immer";
  const parts: string[] = [];
  for (const day of WEEKDAYS) {
    const ds = t.schedule[day];
    if (!ds.enabled) continue;
    if (ds.start && ds.end) parts.push(`${DAY_SHORT[day]} ${ds.start}–${ds.end}`);
    else parts.push(`${DAY_SHORT[day]} ganztägig`);
  }
  return parts.length ? parts.join(" · ") : "keine Zeiten gesetzt";
}
