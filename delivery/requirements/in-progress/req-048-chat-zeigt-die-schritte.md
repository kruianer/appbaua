---
id: req-048
title: Der Chat zeigt, was Claude gerade tut
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-18
---

# Goal (Why)

Im Chat sehe ich meine Frage und irgendwann die Antwort — dazwischen
nichts. Bei einer Aufgabe, die Minuten dauert, weiß ich nicht, ob
Claude arbeitet, in die falsche Richtung läuft oder hängt. Am Rechner
in VS Code sehe ich jeden Schritt; in appbaua sitze ich im Dunkeln.

# Function (What)

Während Claude arbeitet, sehe ich im Gespräch, was es tut: welche
Dateien es liest, welche Befehle es ausführt, was es ändert — dieselben
Schritte, die der Worker im Verlauf zeigt.

Die Schritte stehen unter meiner Nachricht und wachsen, solange
gearbeitet wird. Ist die Antwort da, bleiben sie nachlesbar, treten
aber hinter die Antwort zurück — die Antwort ist die Hauptsache, die
Schritte sind der Weg dorthin.

Beim Zurückschalten auf ein Repo, in dem noch gearbeitet wird, sehe ich
den aktuellen Stand der Schritte, nicht nur „läuft noch".

# Acceptance Criteria

- [x] Given ich schicke eine Nachricht, die Claude zum Lesen einer
      Datei bringt, when es arbeitet, then sehe ich im Gespräch, dass
      es liest.
- [x] Given Claude führt einen Befehl aus, when es arbeitet, then sehe
      ich den Befehl im Gespräch.
- [x] Given Claude arbeitet seit einer Weile, when ich hinsehe, then
      kommen neue Schritte dazu, ohne dass ich etwas tun muss.
- [ ] Given die Antwort ist fertig, when ich das Gespräch ansehe, then
      ist die Antwort hervorgehoben und die Schritte treten zurück.
- [ ] Given die Antwort ist fertig, when ich die Schritte ansehen will,
      then kann ich sie weiterhin lesen.
- [x] Given in "CellarVoice" läuft eine Antwort und ich schalte zu
      "Wellarita" und zurück, when ich hinsehe, then sehe ich den
      aktuellen Stand der Schritte.
- [x] Given ich stoppe einen laufenden Lauf (bug-030), when ich
      hinsehe, then bleiben die bis dahin gezeigten Schritte stehen.
- [ ] Given ich lese ein abgeschlossenes Gespräch auf dem iPhone, when
      ich es durchgehe, then drängen die Schritte die Antworten nicht
      aus dem Bild.
- [x] Given Claude arbeitet, when ich die Schritte lese, then steht
      dort KEIN Zugangsschlüssel und kein Passwort.

# Constraints

- Die Schritte entstehen aus dem Ereignisstrom, den `runClaude` über
  `onOutput` bereits liefert (req-008, bug-001) und den
  `describeEvent` in lesbare Zeilen übersetzt. Der Worker zeigt damit
  seit req-008 seine Schritte; der Chat benutzt beides heute nicht.
  Es ist also eine Verdrahtung, kein Neubau.
- Die Schritte sind Begleitung, nicht Inhalt. Sie dürfen die Antwort
  nicht verdrängen.

# Out of Scope

- Claudes Gedankengänge. Gemeint sind die sichtbaren Schritte
  (gelesene Dateien, ausgeführte Befehle, Änderungen), nicht das
  Nachdenken dazwischen.
- Ein Eingreifen in einen laufenden Schritt (etwa einen Befehl
  freigeben oder ablehnen).
- Dieselbe Anzeige im Verlauf des Workers — die gibt es dort schon.
- Ein Aufbewahren der Schritte über Wochen. Sie gehören zum Gespräch
  und verschwinden mit ihm.
