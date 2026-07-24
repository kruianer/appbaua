---
id: req-007
title: Einstellungsseite mit "Verlauf-Log löschen"
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-24
---

# Goal (Why)

Ich will das komplette Verlauf-Log bewusst und auf einmal löschen können,
unabhängig von der automatischen Kürzung (1 Jahr / 1 Mio Zeilen aus
req-004), damit ich bei Bedarf sauber von vorne anfangen kann.

# Function (What)

Die untere Navigation bekommt einen fünften Punkt "Einstellungen"
(rechts neben "Tasks", Zahnrad-Icon). Die Einstellungsseite zeigt einen
Bereich "Verlauf-Log löschen":

- ein kurzer Erklärtext, dass dies ALLE Verlaufseinträge entfernt —
  anders als die automatische Kürzung bei 1 Jahr / 1 Mio Zeilen, die
  davon unberührt bleibt,
- die aktuelle Anzahl der Einträge ("Aktuell N Einträge im Verlauf"),
- ein Button "Verlauf-Log löschen".

Klick auf den Button öffnet eine Sicherheitsabfrage (Bestätigungsdialog
mit Abbrechen / Löschen). Nach Bestätigen werden alle Log-Einträge
gelöscht; der Verlauf-Tab zeigt danach seinen Leerzustand, und es
erscheint kurz die Bestätigung "Verlauf gelöscht". Gelöscht werden NUR
die Verlaufseinträge — der aktuelle Worker-Status, die Repos, die
Task-Typen und deren Einstellungen bleiben unberührt. Löschen ist
jederzeit möglich, auch während der Worker gerade läuft.

Unter dem Lösch-Bereich steht ein Platzhalter-Hinweis "weitere
Einstellungen folgen".

# GUI

- Kein eigenes Mockup. Der neue Tab und der Bestätigungsdialog lehnen
  sich an das bestehende Nocturne-Design und die vorhandene Bedienung an
  (Bestätigungsdialog wie beim Repo-Entfernen aus req-001).
- Zielgerät: primär Smartphone (Hochformat), responsive — analog req-001.

# Acceptance Criteria

- [ ] Given ich betrachte die untere Navigation, when die App geladen
  ist, then sehe ich fünf Punkte in der Reihenfolge Aktivität, Verlauf,
  Repos, Tasks, Einstellungen.
- [ ] Given im Verlauf existieren 5 Einträge, when ich die
  Einstellungsseite öffne, then sehe ich den Text "Aktuell 5 Einträge im
  Verlauf" und einen Button "Verlauf-Log löschen".
- [ ] Given ich klicke auf "Verlauf-Log löschen", when der Klick
  erfolgt, then erscheint zuerst eine Sicherheitsabfrage "Gesamten
  Verlauf wirklich löschen? Das lässt sich nicht rückgängig machen." mit
  Abbrechen und Löschen.
- [ ] Given die Sicherheitsabfrage ist offen, when ich abbreche, then
  bleiben alle Verlaufseinträge erhalten (es wird NICHTS gelöscht).
- [ ] Given im Verlauf existieren Einträge, when ich das Löschen
  bestätige, then ist das Verlauf-Log danach leer und der Verlauf-Tab
  zeigt "Noch keine Läufe protokolliert".
- [ ] Given ich habe das Löschen bestätigt, when die Aktion fertig ist,
  then sehe ich kurz die Bestätigung "Verlauf gelöscht".
- [ ] Given ich lösche den Verlauf, when die Aktion fertig ist, then sind
  die Repos, die Task-Typen und deren Einstellungen UNVERÄNDERT.

# Out of Scope

- Selektives Löschen (nur bis Datum, nur ein Repo, nur ein Status).
- Export/Backup des Logs vor dem Löschen.
- Weitere Einstellungen auf der Seite (nur der Platzhalter-Hinweis).
- Änderung der automatischen Kürzung (1 Jahr / 1 Mio) aus req-004.
