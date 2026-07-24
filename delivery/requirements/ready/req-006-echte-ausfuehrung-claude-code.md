---
id: req-006
title: Echte Worker-Ausführung über Claude Code (autonom)
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-24
changes: req-004
---

# Goal (Why)

Der Worker soll echte Arbeit erledigen statt zu simulieren: pro Schritt
tatsächlich Claude Code aufrufen, das den anstehenden Task vollständig
und ohne Rückfragen abarbeitet. Ohne echte, rückfragefreie Ausführung
ergibt die ganze App keinen Sinn.

# Function (What)

Ersetzt die 15-Sekunden-Simulation aus req-004 durch echte Ausführung.
Der Loop, die Reihenfolge (Task-Typ-Prio äußere, Repo-Prio innere
Schleife), die Fälligkeit (aktive Repos, aktive+fällige Typen) und der
Hauptschalter (req-003) bleiben wie in req-004. Neu ist, was ein Schritt
tut:

Pro Schritt (ein Repo × ein fälliger Task-Typ):
1. Ziel-Repo klonen bzw. aktualisieren.
2. Aufgabenquelle je nach Typ:
   - **Datei-getriebene Typen** (Bugs, Requirements): im zugehörigen
     Ordner des Ziel-Repos nachsehen — Bugs in `delivery/bugs/ready/`,
     Requirements in `delivery/requirements/ready/`. Die **älteste .md**
     ist der Auftrag. Liegt keine .md dort, wird der Schritt still
     übersprungen (kein Log-Eintrag).
   - **Wiederkehrende Typen** (Code-Review, Security-Review, Doku):
     brauchen keine .md; sie laufen höchstens **einmal pro Kalendertag
     pro Repo × Typ** (abgeleitet aus dem run_log). Lief der Typ heute
     für dieses Repo schon erfolgreich, wird übersprungen.
3. **Claude Code headless** aufrufen mit dem Auftrag "arbeite diese .md
   vollständig ab" (bzw. bei wiederkehrenden Typen die entsprechende
   Standard-Aufgabe) plus dem Repo-Kontext; Claude Code arbeitet
   vollautonom und darf NICHTS fragen.
4. Danach übernimmt der Worker deterministisch: committen, auf den
   Branch `dev` des Ziel-Repos pushen (existiert kein `dev`, anlegen;
   NIE nach `main`), und bei datei-getriebenen Typen die abgearbeitete
   .md von `ready/` nach `done/` verschieben.
5. Ergebnis (Erfolg/Fehler, Start-/Endzeit, Repo, Typ, Kurzmeldung) ins
   run_log schreiben (req-004).

Ein Schritt = genau eine .md (bzw. ein wiederkehrender Lauf). Liegen zwei
.md im Ordner, entstehen zwei Runden — die ältere zuerst. Danach läuft
der Loop wie gehabt weiter von vorne.

# Acceptance Criteria

- [ ] Given der Hauptschalter steht auf "aus", when Zeit vergeht, then
  wird KEIN Claude Code aufgerufen und es entstehen keine neuen
  Log-Einträge.
- [ ] Given im aktiven Repo "appbaua" liegt in `delivery/requirements/
  ready/` genau eine .md und der Typ "Requirements" ist fällig, when der
  Worker den Schritt ausführt, then wird Claude Code für diese .md
  aufgerufen, das Ergebnis auf den `dev`-Branch von "appbaua" gepusht
  und die .md nach `delivery/requirements/done/` verschoben.
- [ ] Given in `delivery/bugs/ready/` liegen zwei .md (erstellt an
  verschiedenen Tagen), when der Worker den Typ "Bugs" für dieses Repo
  abarbeitet, then wird zuerst die ältere .md bearbeitet und erst im
  nächsten Schritt die jüngere.
- [ ] Given der Typ "Bugs" ist fällig, aber `delivery/bugs/ready/` ist
  leer, when der Worker den Schritt erreicht, then wird er still
  übersprungen (kein Claude-Aufruf, kein Log-Eintrag für dieses Repo ×
  Typ).
- [ ] Given der Typ "Code-Review" lief heute für Repo "appbaua" bereits
  erfolgreich, when der Worker im selben Kalendertag erneut an "appbaua ×
  Code-Review" kommt, then wird der Schritt übersprungen.
- [ ] Given ein Claude-Code-Lauf schlägt fehl oder überschreitet 60
  Minuten, when der Schritt endet, then gibt es einen Log-Eintrag mit
  Status "Fehler", die .md wird nach `delivery/<typ>/failed/`
  verschoben, und es wird NICHTS auf `dev` gepusht.
- [ ] Given ein Schritt läuft erfolgreich durch, when der Worker
  committet und pusht, then landet der Commit auf dem `dev`-Branch des
  Ziel-Repos und NICHT auf `main`.

# Constraints

- Claude Code wird headless über die Claude-Code-CLI aufgerufen und nutzt
  das Anthropic-**Abo** des Nutzers (interaktiver `claude login`, im
  Worker-Container per Volume persistiert) — NICHT einen API-Key, damit
  keine Nutzungskosten entstehen. Coden läuft immer mit dem Opus-Modell.
  Der einmalige Login am Mini-PC erfolgt separat (siehe deploy-setup.md).
- Der GitHub-Token muss für die Ziel-Repos Schreibrechte haben
  (Contents: write), damit der Worker auf `dev` pushen kann.
- Claude Code läuft vollautonom und rückfragefrei (non-interaktiv /
  Permissions übersprungen). Ein hängender/fragender Lauf gilt nach 60
  Minuten als Timeout = Fehler.
- Der Worker committet, pusht und verschiebt die .md selbst
  (deterministisch); Claude Code ändert nur den Code im Repo.
- Der Hauptschalter (req-003) stoppt auch die echte Ausführung: bei
  "aus" wird kein Claude Code aufgerufen.

# Out of Scope

- Automatischer Merge nach `main` im Ziel-Repo — bleibt beim Menschen.
- Parallele Ausführung mehrerer Schritte — weiterhin seriell (ein
  Schritt zur Zeit).
- Konfigurierbarkeit von Zeitlimit, Ordnernamen oder Claude-Prompt über
  die Oberfläche (feste Werte in dieser Stufe).
- Wiederholungs-/Backoff-Strategie für nach `failed/` verschobene .md —
  die bleiben dort liegen, bis der Mensch sie ansieht.
- Anzeige der Claude-Code-Ausgabe im Detail in der App (nur Kurzmeldung
  im Log).
