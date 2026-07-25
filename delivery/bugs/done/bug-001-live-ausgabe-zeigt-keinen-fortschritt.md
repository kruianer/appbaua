---
id: bug-001
title: Live-Ausgabe im Aktivität-Tab zeigt keinen echten Fortschritt (nur stdin-Warnung)
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-25
relates: req-006, req-008
---

# Beobachtetes Verhalten

Während der Worker einen Schritt mit Claude Code bearbeitet, zeigt die
Live-Ausgabe im Aktivität-Tab (currentOutput, req-008) über viele Minuten
NUR die immer gleiche Zeile:

  "Warning: no stdin data received in 3s, proceeding without it. If piping
  from a slow command, redirect stdin explicitly: < /dev/null to skip, or
  wait longer."

Es sieht dadurch so aus, als würde der Worker hängen, obwohl Claude Code
in Wahrheit voll arbeitet (Dateien lesen/schreiben, Tests). Das hat
bereits zu einem fälschlichen Abbruch eines laufenden req-009-Laufs
geführt.

# Erwartetes Verhalten

Die Live-Ausgabe zeigt den tatsächlichen Fortschritt von Claude Code —
z.B. die aktuelle Tätigkeit (welches Tool/welche Datei gerade bearbeitet
wird) — und aktualisiert sich sichtbar, solange gearbeitet wird. Man
erkennt am Dashboard, dass der Worker arbeitet und nicht hängt.

# Ursache (diagnostiziert)

Der Worker ruft Claude Code im Print-Modus (`claude -p …`) auf. In diesem
Modus schreibt die CLI auf stdout nur die stdin-Warnung und ganz am Ende
die finale Antwort — die Arbeitsschritte dazwischen (Tool-Calls, Denken)
laufen NICHT über stdout. Die Live-Ausgabe (req-008), die die letzten
stdout-Zeilen spiegelt, bleibt deshalb minutenlang eingefroren, obwohl in
der Claude-Session laufend Ereignisse entstehen.

# Vorgeschlagene Lösung (Richtung)

Den Claude-Aufruf auf strukturierte, streamende Ausgabe umstellen (z.B.
`--output-format stream-json --verbose`), die einzelnen Ereignisse
mitlesen und daraus eine menschenlesbare aktuelle Tätigkeit ableiten, die
der Worker als Live-Zeilen (currentOutput) fortschreibt. Zusätzlich stdin
explizit auf /dev/null legen, damit die Warnung entfällt.

# Akzeptanzkriterien

- [ ] Given der Worker bearbeitet einen Schritt mit Claude Code, when ich
  den Aktivität-Tab betrachte, then ändert sich die Live-Ausgabe im Lauf
  der Bearbeitung sichtbar (nicht dieselbe eingefrorene Zeile über
  Minuten).
- [ ] Given ein Schritt läuft, when ich die Live-Ausgabe lese, then
  erkenne ich die aktuelle Tätigkeit des Workers (z.B. bearbeitete Datei
  oder Arbeitsschritt), nicht nur eine stdin-Warnung.
- [ ] Given ein Schritt läuft, when ich die Live-Ausgabe betrachte, then
  erscheint die "no stdin data received"-Warnung NICHT mehr.
- [ ] Given ein Schritt ist erfolgreich beendet, when der Verlauf-Eintrag
  geschrieben wird, then bleibt das Ergebnis-/Fazit-Verhalten wie bisher
  (req-004) unverändert.

# Out of Scope

- Vollständiges, dauerhaftes Speichern der kompletten Claude-Ausgabe (nur
  die aktuelle Tätigkeit / letzte Zeilen live, wie in req-008).
- Änderungen am 60-Minuten-Timeout oder an der Schritt-Logik selbst.
