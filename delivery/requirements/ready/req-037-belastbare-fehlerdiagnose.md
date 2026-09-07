---
id: req-037
title: Der Verlauf sagt belastbar, was schiefging
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-09-07
---

# Goal (Why)

Wenn etwas fehlschlägt, kostet mich die Suche nach der Ursache Stunden —
und führt trotzdem oft zur falschen Antwort, weil im Verlauf die
entscheidenden Angaben fehlen. Ich will an einem Fehlereintrag ablesen
können, was passiert ist, ohne mich auf den Server einzuloggen und den
Fall nachzustellen.

# Function (What)

Ein Fehlereintrag im Verlauf trägt künftig:

**Die vollständige Meldung.** Heute wird auf die letzten 400 Zeichen
gekürzt — und der Anfang enthält meist die Ursache, das Ende nur die
Folgen. Die ganze Meldung wird gespeichert; die Anzeige zeigt sie
zusammengeklappt und lässt sie aufklappen.

**Eine Fehlerart.** Jeder Fehler bekommt eine von wenigen festen
Kategorien:

- Netzwerk (Verbindung zu GitHub oder zum KI-Anbieter)
- Rate-/Session-Limit
- Anmeldung abgelaufen
- Testsuite rot
- Zeitüberschreitung
- Sonstiges

Sie steht als eigenes Merkmal am Eintrag, nicht nur als Text in der
Meldung. Auf der Aktivitätsseite kann ich nach ihr filtern und sehe, wie
oft welche Art in den letzten Tagen auftrat.

**Umgebungsdaten zum Zeitpunkt des Fehlers.** Bei einem Netzwerkfehler
wird unmittelbar danach gemessen und mitgeschrieben: War das Ziel
erreichbar, und wie lange dauerte der Verbindungsaufbau? Damit ist im
Nachhinein unterscheidbar, ob die Störung anhielt oder ein einzelner
Aussetzer war.

**Der Verlauf des Claude-Laufs bei einem Fehlschlag.** Nicht nur die
letzten Zeilen der Zusammenfassung, sondern was der Lauf zuletzt getan
hat — welche Dateien er anfasste, welchen Schritt er bearbeitete.

# Acceptance Criteria

- [ ] Given ein Lauf scheitert mit einer Meldung, die länger als 400
  Zeichen ist, when ich den Eintrag im Verlauf aufklappe, then sehe ich
  die vollständige Meldung — Anfang und Ende.
- [ ] Given ein Lauf scheitert, weil GitHub nicht erreichbar war, when
  ich den Eintrag ansehe, then ist er als Fehlerart "Netzwerk"
  gekennzeichnet.
- [ ] Given ein Lauf scheitert an einer roten Testsuite, when ich den
  Eintrag ansehe, then ist er als "Testsuite rot" gekennzeichnet und
  NICHT als "Sonstiges".
- [ ] Given Fehler verschiedener Arten in den letzten Tagen, when ich auf
  der Aktivitätsseite nach einer Art filtere, then sehe ich nur die
  Einträge dieser Art.
- [ ] Given ein Netzwerkfehler, when ich den Eintrag aufklappe, then
  finde ich dort das Ergebnis der Erreichbarkeitsmessung, die
  unmittelbar danach gemacht wurde.
- [ ] Given ein Claude-Lauf bricht mitten in der Arbeit ab, when ich den
  Eintrag aufklappe, then sehe ich, an welcher Datei und welchem Schritt
  er zuletzt war.
- [ ] Given ein erfolgreicher Lauf, when ich ihn ansehe, then hat er
  KEINE Fehlerart — das Merkmal gibt es nur bei Fehlern.
- [ ] Given Einträge, die vor dieser Änderung entstanden sind, when ich
  den Verlauf ansehe, then werden sie unverändert angezeigt und
  verursachen keinen Fehler.

# Constraints

- Die Kürzung auf 400 Zeichen sitzt in `failureTail` (`lib/test-gate.ts`,
  Zeile ~176) und wird an mehreren Stellen verwendet. Die Anzeige darf
  weiterhin kürzen — gespeichert wird künftig alles.
- Der Verlauf hält bis zu einer Million Einträge über ein Jahr
  (`LOG_MAX_ROWS`, `LOG_MAX_AGE_DAYS`). Vollständige Meldungen brauchen
  mehr Platz; falls nötig, eine Obergrenze je Eintrag festlegen, die
  großzügig genug ist, um eine Testausgabe zu fassen.
- Die Erreichbarkeitsmessung darf den Lauf nicht nennenswert verzögern
  und nicht selbst scheitern lassen: Sie ist eine Beobachtung, keine
  Bedingung.
- Fehlermeldungen können Zugangsdaten enthalten. Was gespeichert wird,
  muss durch dieselbe Bereinigung laufen, die es heute schon gibt
  (`redact`).

# Out of Scope

- Automatische Deutung der Ursache ("das lag am Router") — hier geht es
  um belastbare Daten, nicht um Schlussfolgerungen.
- Benachrichtigung bei bestimmten Fehlerarten.
- Ein Ausleiten der Logs an ein fremdes System.
- Auswertung über Wochen hinweg (Trends, Diagramme).
- Änderungen am Verhalten des Workers bei Fehlern — das ist req-038.
