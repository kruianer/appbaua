---
id: req-035
title: KI liest die Logs und sagt, was los ist
app: appbaua
area: App-Überwachung
priority: normal
created: 2026-08-29
---

# Goal (Why)

Eine rote Ampel sagt mir, DASS etwas kaputt ist — nicht warum. Heute
müsste ich mich auf den Server einloggen und Logs lesen. Ich will
stattdessen in verständlichen Worten erfahren, was passiert ist, und
Probleme auch dann bemerken, wenn keine Prüfung sie erfasst.

# Function (What)

appbaua lässt die KI der jeweiligen App deren Logs durchsehen und in
wenigen Sätzen zusammenfassen, was auffällt. Das geschieht auf drei
Wegen:

- **regelmäßig**, in einem Abstand, den ich in den Einstellungen festlege
  (Vorgabe einmal täglich, weil jeder Durchlauf Geld kostet);
- **bei einem gemeldeten Ausfall**, damit die Ursache gleich mitkommt;
- **auf Knopfdruck** auf der Karte einer App, wenn ich einen Verdacht
  habe.

Die Analyse lässt sich in den Einstellungen ganz abschalten — sowohl die
regelmäßige als auch die bei Ausfällen.

Das Ergebnis erscheint auf der Karte der App, mit Zeitpunkt. Führte die
Analyse zu einem Befund, geht sie bei einer Ausfallmeldung mit der
Telegram-Nachricht hinaus.

Damit die Meldungen brauchbar bleiben, muss die Analyse zwischen "das ist
normal" und "das ist ein Problem" unterscheiden: Ein Neustart nach einem
Deploy, eine einzelne fehlgeschlagene Anfrage oder eine Warnung, die seit
Wochen im Log steht, sind kein Befund. Findet die KI nichts
Auffälliges, sagt sie das ausdrücklich — statt etwas zu erfinden, damit
die Antwort nicht leer aussieht.

Jede Analyse steht mit ihrem Ergebnis im Verlauf, damit nachvollziehbar
bleibt, wann was gemeldet wurde.

# Acceptance Criteria

- [ ] Given eine App läuft ohne Auffälligkeiten, when die regelmäßige
  Analyse läuft, then steht auf ihrer Karte "keine Auffälligkeiten" mit
  Zeitpunkt und KEIN erfundener Befund.
- [ ] Given eine App ist wegen eines Ausfalls rot gemeldet, when die
  Analyse dazu läuft, then steht die Zusammenfassung auf der Karte und
  geht mit der Telegram-Nachricht hinaus.
- [ ] Given ich klicke auf der Karte einer App "Logs analysieren", when
  die Analyse fertig ist, then sehe ich das Ergebnis auf derselben Karte.
- [ ] Given ich habe die Log-Analyse in den Einstellungen abgeschaltet,
  when eine Prüfung fehlschlägt, then wird KEIN Aufruf an die KI gemacht
  und auf der Karte steht kein Analyse-Ergebnis.
- [ ] Given ich stelle den Abstand der regelmäßigen Analyse auf einmal
  wöchentlich, when die Woche noch nicht um ist, then läuft KEINE
  regelmäßige Analyse — der Knopf auf der Karte funktioniert trotzdem.
- [ ] Given eine App wurde vor zehn Minuten neu deployt und ihre Logs
  zeigen den üblichen Neustart, when die Analyse läuft, then wird das
  NICHT als Problem gemeldet.
- [ ] Given der KI-Anbieter der App antwortet nicht, when eine Analyse
  laufen soll, then bleibt die Überwachung davon unberührt und der
  Fehlschlag steht im Verlauf.
- [ ] Given eine Analyse ist gelaufen, when ich den Verlauf ansehe, then
  finde ich dort einen Eintrag mit App, Zeitpunkt und Ergebnis.

# Constraints

- Die Analyse nutzt den KI-Anbieter und den Schlüssel der jeweiligen App
  (siehe `delivery/health.md` des Repos, req-032), nicht den von appbaua.
  Jeder Durchlauf verursacht Kosten.
- Logs können Zugangsdaten, Schlüssel und personenbezogene Daten
  enthalten. Was an die KI geschickt wird, muss vorher um solche Angaben
  bereinigt werden.
- Die Menge der übertragenen Logzeilen ist begrenzt; ein Tageslog einer
  großen App passt nicht in einen Aufruf.

# Out of Scope

- Selbsttätiges Handeln aufgrund einer Analyse — kein Neustart, keine
  Änderung an einer App.
- Automatisches Anlegen von Bug- oder Requirement-Dateien aus einem
  Befund.
- Durchsuchbare Logs oder ein Log-Archiv in appbaua.
- Analyse der Logs von appbaua selbst.
- Vergleich über die Zeit ("seit dem letzten Deploy häufen sich Fehler").
