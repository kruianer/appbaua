---
id: req-031
title: Backup-Codes neu erzeugen (in den Einstellungen)
app: appbaua
area: Zugang & Sicherheit
priority: normal
created: 2026-07-27
changes: req-023
---

# Goal (Why)

Meine Backup-Codes sehe ich nur ein einziges Mal — bei der Registrierung.
Habe ich sie verlegt oder aufgebraucht, komme ich derzeit nur an neue,
indem ich einen der alten Codes bei der Wiederherstellung verbrauche. Ich
will jederzeit einen frischen Satz erzeugen können, solange ich angemeldet
bin.

# Function (What)

Im Bereich "Zugang & Sicherheit" der Einstellungen (req-023) kommt die
Möglichkeit dazu, einen neuen Satz Backup-Codes zu erzeugen.

- **Für sich selbst:** Jeder angemeldete Nutzer erzeugt Codes nur für sein
  eigenes Konto. Niemand — auch der Betreiber nicht — kann Codes für eine
  andere Person erzeugen oder ansehen.
- **Restanzeige:** Der Bereich zeigt, wie viele Codes noch unverbraucht
  sind, z.B. "noch 7 von 10 Codes übrig".
- **Rückfrage vor dem Erzeugen:** Ein Bestätigungsdialog weist darauf hin,
  dass die bisherigen Codes danach nicht mehr funktionieren. Erst nach
  Bestätigung wird erzeugt.
- **Einmalige Anzeige:** Die neuen Codes erscheinen genau einmal im
  Klartext, in derselben Darstellung wie nach der Registrierung. Danach
  sind sie nur noch als Hashes gespeichert und nicht wieder abrufbar.
- **Alte Codes werden ungültig:** Das Erzeugen ersetzt den kompletten
  bisherigen Satz (das bestehende Verhalten von `issueBackupCodes`).

# Acceptance Criteria

- [ ] Given ich bin angemeldet und habe 10 unverbrauchte Codes, when ich
  die Einstellungen öffne, then sehe ich "noch 10 von 10 Codes übrig".
- [ ] Given ich habe 3 Codes bei Wiederherstellungen verbraucht, when ich
  die Einstellungen öffne, then sehe ich "noch 7 von 10 Codes übrig".
- [ ] Given ich klicke auf "Neue Backup-Codes erzeugen", when der Dialog
  erscheint, then werde ich darauf hingewiesen, dass die alten Codes
  danach nicht mehr gelten, und muss bestätigen.
- [ ] Given ich bestätige den Dialog, when die Codes erzeugt sind, then
  sehe ich 10 neue Codes im Klartext.
- [ ] Given ein neuer Satz wurde erzeugt, when ich einen Code aus dem
  ALTEN Satz bei der Wiederherstellung eingebe, then wird er abgelehnt.
- [ ] Given ich habe die neuen Codes weggeklickt, when ich die
  Einstellungen erneut öffne, then sind die Codes NICHT wieder sichtbar
  (nur der Zähler).
- [ ] Given ich breche den Bestätigungsdialog ab, when ich danach einen
  bisherigen Code verwende, then funktioniert er weiterhin (es wurde
  nichts erzeugt).

# Out of Scope

- Codes für andere Nutzer erzeugen oder einsehen (auch nicht als
  Betreiber).
- Einzelne Codes nachlegen, statt den ganzen Satz zu ersetzen.
- Anzahl der Codes konfigurierbar machen (bleibt bei 10,
  `BACKUP_CODE_COUNT`).
- Export/Download der Codes als Datei oder Versand per E-Mail.
