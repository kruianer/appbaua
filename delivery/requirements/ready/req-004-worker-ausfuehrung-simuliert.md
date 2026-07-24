---
id: req-004
title: Simulierte Worker-Ausführung mit Log und Verlauf-Ansicht
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-24
---

# Goal (Why)

Ich will sehen, dass der Worker meine konfigurierten Repos und
Task-Typen in der richtigen Reihenfolge und zu den richtigen Zeiten
durchgeht — vorerst ohne echte Ausführung, damit ich den Ablauf und die
Protokollierung abnehmen kann, bevor echt gearbeitet wird.

# Function (What)

Der Worker läuft dauerhaft (solange der Hauptschalter aus req-003 "an"
ist) und geht wiederholt seine Arbeit durch. Statt echt auszuführen
wartet er pro Arbeitsschritt 15 Sekunden und meldet Erfolg (bzw.
gelegentlich einen simulierten Fehler).

Ein Schritt = eine Kombination aus einem Repo und einem Task-Typ
(z.B. "appbaua × Bugs"). Reihenfolge: Task-Typ-Priorität ist die äußere
Schleife, Repo-Priorität die innere — also der wichtigste Task-Typ über
alle Repos zuerst, dann der nächste Typ. Berücksichtigt werden nur
aktive Repos (req-001) und aktive, jetzt-fällige Task-Typen (req-002:
"immer" oder aktuell im Wochentag/Zeit-Fenster).

Vor jedem Schritt prüft der Worker neu, ob Repo und Typ noch aktiv und
fällig sind; sonst überspringt er den Schritt. Findet ein kompletter
Durchlauf nichts Fälliges, wartet der Worker 5 Minuten und schreibt beim
Start des nächsten Durchlaufs einen "nichts zu tun"-Logeintrag.

Jeder Schritt und jeder "nichts zu tun"-Fall wird in der Datenbank
protokolliert (Startzeit, Endzeit, Repo, Task-Typ, Status, Meldung). Das
Protokoll ist im Tab "Verlauf" der Webapp sichtbar.

# Acceptance Criteria

- [ ] Given der Hauptschalter steht auf "aus", when Zeit vergeht, then
  läuft kein Durchlauf und es entstehen KEINE neuen Log-Einträge.
- [ ] Given der Hauptschalter steht auf "an" und es gibt das aktive Repo
  "appbaua" und den aktiven, fälligen Task-Typ "Bugs", when der Worker
  den Schritt "appbaua × Bugs" ausführt, then dauert der Schritt rund 15
  Sekunden und es entsteht ein Log-Eintrag mit Status "Erfolg".
- [ ] Given die Task-Typen "Bugs" (Prio 1) und "Requirements" (Prio 2)
  und die Repos "appbaua" (Prio 1) und "worker" (Prio 2) sind alle aktiv
  und fällig, when ein Durchlauf startet, then ist die Reihenfolge der
  Schritte: Bugs×appbaua, Bugs×worker, Requirements×appbaua,
  Requirements×worker.
- [ ] Given ein Task-Typ ist inaktiv oder liegt außerhalb seines
  Zeit-Fensters, when der Worker den Durchlauf macht, then erscheint für
  diesen Typ KEIN Log-Eintrag.
- [ ] Given ein kompletter Durchlauf findet nichts Fälliges, when der
  nächste Durchlauf startet, then gibt es genau einen Log-Eintrag mit
  Status "nichts zu tun".
- [ ] Given der Worker arbeitet Schritte ab, when rund jeder 10. Schritt
  erreicht wird, then hat dieser Schritt im Log den Status "Fehler" und
  der Worker macht danach mit dem nächsten Schritt weiter.
- [ ] Given der Worker führt gerade einen Schritt aus, when ich den
  Hauptschalter auf "aus" stelle, then wird der laufende Schritt noch zu
  Ende geführt und geloggt, danach stoppt der Worker vor dem nächsten
  Schritt.
- [ ] Given ich öffne den Tab "Verlauf", when Log-Einträge existieren,
  then sehe ich sie neueste zuerst, je 50 pro Seite, mit Start-/Endzeit,
  Repo × Task-Typ, Status und Meldung.

# Constraints

- Der Ausführungs-Loop läuft serverseitig und unabhängig davon, ob die
  Weboberfläche geöffnet ist — der Worker arbeitet unbeaufsichtigt.
- In dieser Ausbaustufe wird NICHTS real ausgeführt: jeder Schritt ist
  eine 15-Sekunden-Simulation. Echte Ausführung ist nicht Teil dieses
  Requirements.
- Aufbewahrung des Logs: Einträge älter als 1 Jahr ODER über 1 Million
  Zeilen hinaus (älteste zuerst) werden beim Schreiben automatisch
  entfernt.

# Out of Scope

- Echte Ausführung von Bugs/Requirements/Reviews (Klonen, Code ändern,
  committen) — spätere Requirements.
- Die prominente "was mache ich gerade"-Anzeige auf der Startseite —
  separates req-005.
- Konfigurierbarkeit der 15-Sekunden-Dauer, der 5-Minuten-Pause oder der
  Fehlerrate über die Oberfläche (feste Werte in dieser Stufe).
- Filter/Suche im Verlauf (z.B. nach Repo oder Status).
- Export des Logs.
