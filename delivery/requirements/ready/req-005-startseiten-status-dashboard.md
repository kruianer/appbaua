---
id: req-005
title: Worker-Status und Mini-Dashboard auf der Startseite
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-24
changes: req-004
---

# Goal (Why)

Ich will auf der Startseite auf einen Blick sehen, was der Worker gerade
tut und wie es ihm insgesamt geht, ohne in den Verlauf wechseln zu
müssen — damit ich den laufenden Betrieb sofort erfasse.

# Function (What)

Oben im Repos-Tab (die Seite, die beim Öffnen erscheint) steht prominent
eine Worker-Status-Anzeige plus ein kleines Dashboard aus vier Kacheln.

Status-Anzeige (genau ein Zustand, da seriell nur ein Schritt aktiv sein
kann):
- läuft: zeigt den aktuellen Schritt "Task-Typ × Repo" (z.B. "Bugs ×
  appbaua") mit einem Live-Indikator und einer hochzählenden Dauer
  ("seit 0:08"),
- Pause: "Pause bis HH:MM" (bis zum nächsten Durchlauf),
- Leerlauf: "Leerlauf — nichts zu tun",
- gestoppt: wenn der Hauptschalter (req-003) aus ist.

Vier Kacheln:
- Heute: erledigte Schritte seit 00:00 lokaler Zeit, davon Fehler,
- Aktive Repos: n von gesamt,
- Fällige Task-Typen jetzt: Anzahl aktueller, im Zeitfenster liegender
  aktiver Typen,
- Letzter Fehler: Zeitpunkt + Kurztext des letzten Fehler-Schritts, oder
  "Kein Fehler bisher".

Die Kacheln spiegeln immer die Konfiguration (auch wenn der Hauptschalter
aus ist); nur die Status-Anzeige sagt dann "gestoppt". Die Anzeige
aktualisiert sich automatisch etwa alle 5 Sekunden ohne Neuladen. Die
Historie bleibt im Verlauf-Tab (req-004); hier wird nichts dupliziert.

Erweiterung an req-004: Der Worker hält seinen aktuell laufenden Schritt
(Task-Typ, Repo, Startzeit) und den Endzeitpunkt der 5-Minuten-Pause
fest, solange sie andauern, und räumt den laufenden Schritt nach dessen
Abschluss wieder weg. Nur so kann die Startseite den echten Live-Zustand
zeigen.

# GUI

- Kein eigenes Mockup. Die Status-Karte greift die im Nocturne-Design
  bereits vorgesehene Worker-Karte oben im Repos-Tab auf; Kacheln im
  gleichen Stil (Nocturne, konsistent zu req-001/002).
- Zielgerät: primär Smartphone (Hochformat), responsive — analog req-001.

# Acceptance Criteria

- [ ] Given der Worker führt gerade den Schritt "Bugs × appbaua" aus,
  when ich die Startseite betrachte, then sehe ich oben "Bugs × appbaua"
  mit einer hochzählenden Dauer, und die Dauer erhöht sich sichtbar ohne
  Neuladen.
- [ ] Given der Worker ist in der 5-Minuten-Pause bis 14:35, when ich die
  Startseite betrachte, then zeigt die Status-Anzeige "Pause bis 14:35".
- [ ] Given der Hauptschalter steht auf "aus", when ich die Startseite
  betrachte, then zeigt die Status-Anzeige "gestoppt".
- [ ] Given heute wurden 3 Schritte erledigt, davon 1 Fehler, when ich
  die Startseite betrachte, then zeigt die Kachel "Heute" 3 erledigt und
  1 Fehler.
- [ ] Given es sind 2 von 5 Repos aktiv, when ich die Startseite
  betrachte, then zeigt die Kachel "Aktive Repos" 2 von 5.
- [ ] Given es gab noch nie einen Fehler-Schritt, when ich die Startseite
  betrachte, then zeigt die Kachel "Letzter Fehler" den Text "Kein
  Fehler bisher".
- [ ] Given der Hauptschalter steht auf "aus", when ich die Startseite
  betrachte, then zeigen die Kacheln weiterhin die konfigurierten Zahlen
  (aktive Repos, fällige Typen) und NICHT 0.

# Constraints

- Der Worker aus req-004 wird erweitert (nicht ersetzt): er schreibt den
  laufenden Schritt und den Pausen-Endzeitpunkt fort. Kein paralleler
  zweiter Worker.

# Out of Scope

- Trend-/Verlaufsgrafiken (z.B. Schritte pro Stunde) — späteres
  Requirement.
- Bedienelemente auf der Startseite (Worker starten/stoppen bleibt in der
  Task-Steuerung, req-003).
- Live-Push/WebSocket — das ~5-Sekunden-Polling genügt.
- Detailansicht eines einzelnen Schritts beim Antippen der Kacheln.
