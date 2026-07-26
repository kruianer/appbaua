---
id: req-029
title: Worker pausiert bei Rate-Limit und versucht später automatisch erneut
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-26
changes: req-004, req-006
---

# Goal (Why)

Wenn der Worker an ein Rate-Limit stößt, will ich, dass er nicht das
Requirement verliert und einfach abbricht, sondern eine Pause macht und
es später automatisch erneut versucht — damit kein Requirement wegen
eines vorübergehenden Limits als "fehlgeschlagen" verloren geht (wie
zuletzt beim Rover).

# Function (What)

Der Worker erkennt, wenn ein Claude-Lauf an einem Rate-/Usage-Limit
scheitert (aus der Fehlermeldung/Ausgabe des Claude-Laufs), und behandelt
das als eigenen Fall — NICHT als normalen Fehlschlag:

1. **Kein Fehlschlag:** Das gerade bearbeitete Requirement/Bug wird NICHT
   nach failed/ verschoben. Die .md bleibt in ready/ (bzw. wandert
   dorthin zurück, falls sie schon nach in-progress/ gewandert war),
   sodass sie später erneut versucht wird. Es wird auch kein
   Fehler-Verlaufseintrag geschrieben, der wie ein echter Fehlschlag
   aussieht.
2. **Pause bis zum Reset:** Der Worker pausiert bis zu dem Zeitpunkt, zu
   dem das Limit laut Fehlermeldung zurücksetzt. Nennt die Meldung keinen
   Zeitpunkt, macht er eine feste Pause von etwa einer Stunde.
3. **Automatischer Wiederanlauf:** Nach der Pause nimmt der Worker seine
   Arbeit selbstständig wieder auf und versucht die Queue erneut.
4. **Sichtbarer Status:** Während der Rate-Limit-Pause zeigt die
   Aktivitätskarte einen eigenen Status "Pause wegen Rate-Limit bis
   HH:MM". In dieser Zeit startet der Worker keine neuen Claude-Läufe.

# Acceptance Criteria

- [ ] Given ein Claude-Lauf scheitert erkennbar an einem Rate-/Usage-
  Limit, when der Schritt endet, then wird das bearbeitete Requirement
  NICHT nach failed/ verschoben, sondern verbleibt in ready/.
- [ ] Given ein Rate-Limit wurde erkannt und die Meldung nennt einen
  Reset-Zeitpunkt, when der Worker pausiert, then dauert die Pause bis zu
  diesem Zeitpunkt.
- [ ] Given ein Rate-Limit wurde erkannt und die Meldung nennt KEINEN
  Reset-Zeitpunkt, when der Worker pausiert, then dauert die Pause etwa
  eine Stunde.
- [ ] Given die Rate-Limit-Pause läuft, when ich die Aktivitätskarte
  ansehe, then sehe ich den Status "Pause wegen Rate-Limit bis HH:MM".
- [ ] Given die Rate-Limit-Pause ist abgelaufen, when der Worker
  weiterläuft, then versucht er das zuvor betroffene Requirement erneut
  (es ist noch in ready/).
- [ ] Given ein Claude-Lauf scheitert aus einem ANDEREN Grund (nicht
  Rate-Limit), when der Schritt endet, then greift das bisherige Verhalten
  (Fehlschlag/failed nach den Regeln von req-019/req-025), NICHT die
  Rate-Limit-Pause.

# Constraints

- Ob ein Fehlschlag ein Rate-Limit ist, wird aus der Fehlermeldung/
  Ausgabe des Claude-Laufs erkannt (z.B. entsprechende Meldung / 429 /
  "usage limit"). Nur solche Fälle lösen die Pause aus.

# Out of Scope

- Verhindern, DASS ein Rate-Limit auftritt (das steuert die
  Modell-Wahl, req-028, und die Konfiguration) — hier geht es nur um die
  Reaktion darauf.
- Zunehmend längere Backoff-Staffelung — es genügt: bis Reset-Zeitpunkt,
  sonst ~1 Stunde.
- Benachrichtigung des Nutzers außerhalb der App (z.B. Push/Mail) über
  die Rate-Limit-Pause.
