---
id: req-008
title: Worker-Beobachtbarkeit — in-progress, MD-Name, Live-Ausgabe
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-24
changes: req-004, req-005
---

# Goal (Why)

Ich will jederzeit sehen, was der Worker gerade tut — welche Datei er
bearbeitet und was Claude Code dabei ausgibt — und der Zustand der
Requirement-Dateien soll den echten Bearbeitungsstand widerspiegeln,
damit der Betrieb nachvollziehbar bleibt.

# Function (What)

Drei zusammenhängende Verbesserungen:

1. **in-progress-Ordner:** Beim Start eines datei-getriebenen Schritts
   (Bugs, Requirements) verschiebt der Worker die bearbeitete .md von
   `ready/` nach `in-progress/`. Bei Erfolg wandert sie nach `done/`, bei
   Fehler nach `failed/`. Findet der Worker beim Start eine .md, die noch
   in `in-progress/` liegt (von einem abgestürzten/unterbrochenen Lauf),
   schiebt er sie zurück nach `ready/`, damit sie erneut versucht wird.

2. **MD-Name in der Aktivität:** Im Aktivität-Tab zeigt der laufende
   Schritt unter der bestehenden Zeile "Task-Typ × Repo" eine zweite
   Zeile mit dem Namen der gerade bearbeiteten .md. Bei wiederkehrenden
   Typen (Code-Review, Doku, Security-Review), die keine .md haben, steht
   dort der Platzhaltertext "wiederkehrende Aufgabe".

3. **Live-Ausgabe von Claude Code:** Während ein Schritt läuft, schreibt
   der Worker die laufende Ausgabe von Claude Code fortlaufend (gedrosselt
   höchstens etwa einmal pro Sekunde, als aktueller Stand der letzten ~50
   Zeilen) in die Datenbank am aktuellen Schritt. Der Aktivität-Tab zeigt
   diese letzten ~50 Zeilen in einem mitlaufenden Ausgabe-Feld unter dem
   Status, im selben ~5-Sekunden-Takt wie der übrige Status. Ist der
   Schritt fertig (Erfolg oder Fehler), verschwindet die Live-Ausgabe;
   das Ergebnis steht wie gehabt im Verlauf-Log (req-004).

# GUI

- Kein eigenes Mockup. Die zweite Zeile und das Ausgabe-Feld lehnen sich
  an das bestehende Nocturne-Design und die Worker-Status-Karte aus
  req-005 an.
- Zielgerät: primär Smartphone (Hochformat), responsive — analog req-001.

# Acceptance Criteria

- [ ] Given der Worker beginnt einen Schritt für eine .md aus
  `delivery/requirements/ready/`, when der Schritt startet, then liegt
  diese .md in `delivery/requirements/in-progress/` und nicht mehr in
  `ready/`.
- [ ] Given der Worker hat eine .md erfolgreich abgearbeitet, when der
  Schritt endet, then liegt die .md in `done/` (nicht mehr in
  `in-progress/`).
- [ ] Given der Worker startet und findet eine .md in `in-progress/` von
  einem früheren, unterbrochenen Lauf, when er den ersten Durchlauf macht,
  then liegt diese .md wieder in `ready/`.
- [ ] Given der Worker bearbeitet gerade die Datei
  "req-042-beispiel.md", when ich den Aktivität-Tab betrachte, then sehe
  ich unter "Requirements × appbaua" eine zweite Zeile mit
  "req-042-beispiel.md".
- [ ] Given der Worker führt gerade einen wiederkehrenden Typ
  (Code-Review) aus, when ich den Aktivität-Tab betrachte, then steht in
  der zweiten Zeile "wiederkehrende Aufgabe".
- [ ] Given Claude Code läuft und produziert Ausgabe, when ich den
  Aktivität-Tab betrachte, then sehe ich unter dem Status ein Feld mit
  den letzten Ausgabezeilen, das sich ohne Neuladen aktualisiert.
- [ ] Given ein Schritt ist fertig, when ich den Aktivität-Tab betrachte,
  then ist die Live-Ausgabe nicht mehr sichtbar.

# Out of Scope

- Vollständiges, dauerhaftes Speichern der kompletten Claude-Ausgabe pro
  Schritt (nur die letzten ~50 Zeilen live; das Ergebnis-Kurzfazit bleibt
  im Verlauf-Log).
- Farbige/formatierte Darstellung der Claude-Ausgabe (reiner Text).
- Live-Ausgabe für zurückliegende, abgeschlossene Schritte.
- Konfigurierbarkeit der Zeilenzahl oder Taktung über die Oberfläche.
