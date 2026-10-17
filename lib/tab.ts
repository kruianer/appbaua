// Die Module der App (req-039/req-041) — geteilt zwischen AppShell (eigener
// Zustand, untere Leiste am iPhone) und Sidebar (Seitenleiste ab 744px),
// damit beide ohne Zirkelbezug auf denselben Typ zugreifen können.
export type Tab =
  | "aktiv"
  | "zustand"
  | "verlauf"
  | "chat"
  | "repos"
  | "settings"
  | "einstellungen";
