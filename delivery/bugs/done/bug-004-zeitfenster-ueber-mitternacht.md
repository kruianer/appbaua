---
id: bug-004
title: Zeitfenster über Mitternacht (z.B. 22:00–06:00) sind nicht möglich
app: appbaua
area: Worker-Steuerung
priority: high
created: 2026-07-25
relates: req-002, req-004
quelle: Code-Review 2026-07-25 (Punkt 5)
---

# Beobachtetes Verhalten

`isValidWindow` (`lib/task-types.ts:90-96`) verlangt `end > start`, und
`isTaskDue` (`lib/scheduling.ts:38`) prüft `nowMin >= start && nowMin <=
end`. Ein Zeitfenster über Mitternacht wie „22:00–06:00" lässt sich damit
weder speichern (Ende vor Anfang → abgelehnt) noch auswerten. Die Vision
nennt Nacht-Zeitfenster für die Hintergrund-Tasks P3–P5 ausdrücklich als
Zweck („der Mensch ist nachts nicht erreichbar"), es ist also eine echte
Funktionslücke, kein Randfall.

# Erwartetes Verhalten

Ein Zeitfenster, dessen Ende vor dem Anfang liegt, gilt als Fenster über
Mitternacht: Es lässt sich speichern, und der Task ist fällig, wenn die
aktuelle Uhrzeit >= Start ODER <= Ende ist (z.B. 22:00–06:00 ist von
22:00 bis 23:59 und von 00:00 bis 06:00 fällig).

# Vorgeschlagene Lösung (aus dem Review)

- `isValidWindow` so anpassen, dass `end < start` als gültiges
  Über-Mitternacht-Fenster erlaubt ist (nur `end === start` bleibt
  ungültig / bzw. als 24h behandeln — Verhalten definieren).
- `isTaskDue` für den Fall `end < start` die Über-Mitternacht-Logik
  verwenden (`now >= start || now <= end`).

# Akzeptanzkriterien

- [ ] Given ich trage für einen Task-Typ am Montag das Fenster
  22:00–06:00 ein, when ich es speichere, then wird es akzeptiert und
  bleibt erhalten (keine „Endzeit muss nach der Startzeit"-Ablehnung).
- [ ] Given ein Task-Typ hat Montag 22:00–06:00 und es ist Montag 23:30,
  when der Worker die Fälligkeit prüft, then gilt der Typ als fällig.
- [ ] Given ein Task-Typ hat Montag 22:00–06:00 und es ist Dienstag
  02:00, when der Worker die Fälligkeit prüft, then gilt der Typ als
  fällig.
- [ ] Given ein Task-Typ hat Montag 22:00–06:00 und es ist Montag 12:00,
  when der Worker die Fälligkeit prüft, then gilt der Typ NICHT als
  fällig.

# Out of Scope

- Mehrere Fenster pro Tag (weiterhin eins pro Wochentag).
