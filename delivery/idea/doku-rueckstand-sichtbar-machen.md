---
titel: "Doku-Rückstand sichtbar machen"
datum: 2026-08-27
---

## Problem/Nutzen

Der Doku-Task (req-016) leitet den Inhalt der Benutzer-Doku aus
`delivery/requirements/done/` und dem Code ab und aktualisiert
`site/user-docs/` ausdrücklich **inkrementell** — er baut die Seite
nicht bei jedem Lauf neu, sondern läuft höchstens einmal pro Tag und
konkurriert dabei mit den anderen Task-Typen um dieselbe Nacht (die
Auswahl-Logik entscheidet pro Durchlauf, welcher Task-Typ dran ist).
Das heißt zwangsläufig: Requirements können in `done/` landen, ohne
dass der Doku-Task in derselben oder den nächsten Nächten überhaupt an
der Reihe war. Von außen ist das nicht zu unterscheiden von "die Doku
ist vollständig aktuell" — die Website zeigt in beiden Fällen einfach
ihren letzten Stand, ohne ein Signal dafür, ob ein frisch umgesetztes
Requirement bereits eingearbeitet ist oder noch aussteht.

Für ein Projekt, dessen eigene Ideen-Richtung "Nachvollziehbarkeit"
als Schwerpunkt nennt, ist das eine stille Lücke: Der Nutzer müsste
`delivery/requirements/done/` und `site/user-docs/` von Hand
gegenlesen, um zu wissen, ob ein neues Feature schon dokumentiert ist
— genau die Art von unsichtbarem Rückstand, die laut
[Schritt-Beleg-Idee](schritt-beleg-quality-gate-nachweis.md) und
[Sicherheits-Befund-Verlauf](sicherheits-befund-verlauf.md) bereits als
teuerstes Muster dieses Systems gilt: ein Zustand, der wie der gute
Normalfall aussieht, es aber nicht ist.

Nutzen:

- **Nachvollziehbarkeit** — auf einen Blick sichtbar, welche
  umgesetzten Requirements bereits in der Doku stehen und welche noch
  offen sind, statt zwei Ordner von Hand zu vergleichen.
- **Rock-solid Qualität** — verhindert, dass sich unbemerkt ein
  Rückstand aufbaut, der irgendwann viele Requirements auf einmal
  betrifft und dann als großer Nacharbeits-Berg auffällt.
- **Ansprechende Visualisierung** — ein Abdeckungs-Status statt einer
  reinen Textliste.

## Skizze

**Kern:** Der Doku-Task hält am Ende jedes Laufs fest, welche
Requirement-IDs aus `delivery/requirements/done/` bereits eine
entsprechende Seite bzw. einen entsprechenden Abschnitt unter
`site/user-docs/` haben (reine Lese-/Abgleichs-Logik auf Basis dessen,
was der Task ohnehin gerade bearbeitet oder bereits bearbeitet hat —
kein neuer Prüfmechanismus). Requirements in `done/`, die in keinem
Lauf als abgedeckt markiert wurden, gelten als **dokumentations-
offen**, mit Zeitstempel seit wann.

**Darstellung — Doku-Abdeckungs-Kachel** (z. B. neben den
Review-/Security-Übersichten):

```
📖 Doku-Abdeckung · appbaua
   ✓ 24 von 26 Requirements dokumentiert
   ○ req-030 — offen seit 3 Tagen (2026-08-24, done/)
   ○ req-031 — offen seit 1 Tag (2026-08-26, done/)
```

Ein Requirement, das schon länger offen ist, wird optisch dringlicher
markiert (ähnlich dem Farbverlauf der Sicherheits-Befund-Idee), damit
"seit einer Woche unbearbeitet" sich sichtbar von "erst gestern
fertig geworden" unterscheidet.

**Ehrlichkeits-Regel:** Ein Requirement gilt nur dann als
"dokumentiert", wenn der Doku-Task es tatsächlich bearbeitet hat —
nicht schon deshalb, weil es plausibel zum bestehenden Seiteninhalt
passen könnte. Lief der Doku-Task lange nicht, wächst die offene Liste
sichtbar, statt sich hinter dem letzten Seitenstand zu verstecken.

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene auf Basis der ohnehin
vom Doku-Task erzeugten Information. Kein Aufweichen des Human-Gates,
keine automatische Priorisierung des Doku-Tasks gegenüber anderen
Task-Typen und keine Änderung der bestehenden Auswahl-Logik — die Idee
macht nur sichtbar, was an Doku-Rückstand bereits besteht. Wie genau
ein Requirement als "abgedeckt" erkannt wird (z. B. Markierung durch
den Task selbst vs. Ableitung aus dem Seiteninhalt), ist vor der
Umsetzung zu bestätigen, nicht stillschweigend vorauszusetzen.
