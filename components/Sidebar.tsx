"use client";

import type { CSSProperties } from "react";
import type { Tab } from "@/lib/tab";
import { Icon, type IconName } from "./Icon";

// req-041: Seitenleiste ab 744px Fensterbreite — ersetzt dort die untere
// Leiste aus req-039. Alle Menüpunkte stehen oben, nur Einstellungen unten;
// "Mehr" gibt es hier nicht, Zustand und Tasks haben eigene Einträge.
const NAV_ITEMS: { key: Tab; label: string; icon: IconName }[] = [
  { key: "aktiv", label: "Aktivität", icon: "activity" },
  { key: "verlauf", label: "Verlauf", icon: "clock" },
  { key: "chat", label: "Chat", icon: "chat" },
  { key: "repos", label: "Repos", icon: "gitbranch" },
  { key: "settings", label: "Tasks", icon: "list" },
  { key: "zustand", label: "Zustand", icon: "heart" },
  { key: "releaseinfo", label: "Release-Infos", icon: "megaphone" },
];

const muted = (pct: number) =>
  `color-mix(in srgb, var(--color-text) ${pct}%, transparent)`;

function navItemStyle(
  active: boolean,
  collapsed: boolean,
  isChat: boolean,
): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 11,
    border: "none",
    background: active
      ? isChat
        ? "color-mix(in srgb, var(--color-accent) 18%, transparent)"
        : "color-mix(in srgb, var(--color-accent) 13%, transparent)"
      : "transparent",
    boxShadow: isChat ? "inset 0 0 0 1px var(--color-accent)" : "none",
    cursor: "pointer",
    color: active
      ? isChat
        ? "var(--color-accent-200)"
        : "var(--color-accent)"
      : isChat
        ? "var(--color-accent-300)"
        : muted(52),
    font: "inherit",
    fontSize: 14,
    borderRadius: "var(--radius-md)",
    padding: collapsed ? 0 : "9px 10px",
    width: collapsed ? 44 : "100%",
    height: collapsed ? 44 : undefined,
    justifyContent: collapsed ? "center" : "flex-start",
    textAlign: "left",
    margin: isChat ? "6px 0" : 0,
  };
}

export function Sidebar({
  tab,
  onSelect,
  collapsed,
  onToggleCollapsed,
}: {
  tab: Tab;
  onSelect: (t: Tab) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  return (
    <nav
      aria-label="Hauptnavigation"
      style={{
        flex: "none",
        width: collapsed ? 68 : 212,
        display: "flex",
        flexDirection: "column",
        borderRight: "1px solid var(--color-divider)",
        padding: "14px 0 12px",
        gap: 2,
        alignItems: collapsed ? "center" : "stretch",
        paddingInline: collapsed ? 0 : 12,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: collapsed ? "0 0 16px" : "0 4px 16px",
        }}
      >
        <div
          style={{
            flex: "none",
            display: "grid",
            placeItems: "center",
            color: "var(--color-accent)",
          }}
        >
          <Icon name="brand" size={26} sw={1.6} />
        </div>
        {!collapsed && (
          <div style={{ lineHeight: 1.02, minWidth: 0 }}>
            <strong
              style={{
                display: "block",
                fontSize: 15,
                fontWeight: 700,
                letterSpacing: "-.03em",
              }}
            >
              appbaua
            </strong>
            <span
              style={{
                display: "block",
                fontSize: 8,
                letterSpacing: ".16em",
                textTransform: "uppercase",
                color: muted(46),
              }}
            >
              Coding-Worker
            </span>
          </div>
        )}
      </div>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          aria-label={item.label}
          title={collapsed ? item.label : undefined}
          onClick={() => onSelect(item.key)}
          style={navItemStyle(tab === item.key, collapsed, item.key === "chat")}
        >
          <Icon name={item.icon} size={19} />
          {!collapsed && <span>{item.label}</span>}
        </button>
      ))}

      <div style={{ flex: 1 }} />

      <button
        aria-label="Einstellungen"
        title={collapsed ? "Einstellungen" : undefined}
        onClick={() => onSelect("einstellungen")}
        style={navItemStyle(tab === "einstellungen", collapsed, false)}
      >
        <Icon name="settings" size={19} />
        {!collapsed && <span>Einstellungen</span>}
      </button>

      <button
        aria-label={
          collapsed ? "Seitenleiste aufklappen" : "Seitenleiste einklappen"
        }
        onClick={onToggleCollapsed}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          font: "inherit",
          fontSize: 12,
          borderRadius: "var(--radius-md)",
          padding: collapsed ? 0 : "7px 10px",
          marginTop: 4,
          width: collapsed ? 44 : "100%",
          height: collapsed ? 38 : undefined,
          justifyContent: collapsed ? "center" : "flex-start",
          color: muted(40),
        }}
      >
        <Icon name={collapsed ? "chevronRight" : "chevronLeft"} size={16} />
        {!collapsed && <span>Einklappen</span>}
      </button>
    </nav>
  );
}
