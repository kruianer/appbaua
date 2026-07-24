---
id: req-002
title: Task-Typen im Webapp verwalten (Priorität + Zeiten)
app: appbaua
area: Worker-Steuerung
priority: high
created: 2026-07-24
---

# Goal (Why)

Ich will festlegen, welche Task-Typen (Bugs, Requirements, Code-Review,
Doku, Ideen) der Worker in welcher Priorität und zu welchen Zeiten
bearbeitet, damit niedrig priorisierte Arbeit z.B. nur zu bestimmten
Zeiten läuft und ich die Kontrolle über die Auslastung behalte.

# Function (What)

Eine Seite in der Webapp zeigt eine sortierbare Liste der fünf
vordefinierten Task-Typen. Die Typen sind fest vorgegeben; ich kann sie
weder anlegen noch löschen, nur einstellen. Pro Typ kann ich:

- die Priorität per Drag & Drop festlegen — Position 1 = höchste
  Priorität,
- den Typ aktiv/inaktiv schalten (inaktiv = läuft nie, unabhängig von
  den gesetzten Zeiten),
- pro Wochentag (Montag bis Sonntag) einzeln festlegen, ob und in
  welchem Uhrzeit-Fenster (von–bis, Format HH:MM) der Typ an diesem Tag
  laufen darf.

Die Einstellungen gelten global für den ganzen Worker (nicht pro Repo).
Jede Änderung wird sofort automatisch gespeichert und ist sofort
wirksam.

# GUI

- Kein eigenes Mockup vorhanden. Das UI lehnt sich stilistisch an das
  bestehende Nocturne-Design und die Repo-Verwaltung aus req-001 an
  (gleiche Listen-, Drag-, Toggle- und Sortier-Bedienung), damit die
  Bedienung konsistent ist.
- Zielgerät: primär Smartphone (Hochformat), responsive, sodass es auf
  iPad/Laptop nicht zerbricht — analog req-001.

# Acceptance Criteria

- [ ] Given ich öffne die Task-Steuerung zum ersten Mal, when die Seite
  lädt, then sehe ich die fünf Typen in dieser Reihenfolge: "Bugs",
  "Requirements", "Code-Review", "Doku", "Ideen".
- [ ] Given die Typen "Bugs" (Position 1) und "Requirements" (Position
  2), when ich "Requirements" per Drag & Drop an Position 1 ziehe, then
  steht "Requirements" oben und die neue Reihenfolge bleibt auch nach
  Neuladen der Seite erhalten.
- [ ] Given der Typ "Doku" ist aktiv, when ich ihn auf inaktiv schalte,
  then bleibt er an seiner Position und wird als inaktiv dargestellt
  (ausgegraut); seine gespeicherten Wochentage/Zeiten bleiben erhalten.
- [ ] Given ich klappe den Typ "Code-Review" auf, when ich Mittwoch
  anhake und als Fenster 17:00–19:00 eintrage, then ist für Code-Review
  am Mittwoch das Fenster 17:00–19:00 gespeichert (sichtbar auch nach
  Neuladen).
- [ ] Given ich hake bei "Ideen" Montag an, aber trage kein Uhrzeit-
  Fenster ein, when ich die Ansicht verlasse, then gilt Montag als
  ganztägig (00:00–23:59) für "Ideen".
- [ ] Given ich trage für "Bugs" am Dienstag das Fenster 19:00–17:00
  ein (Ende vor Anfang), when ich das Feld verlasse, then sehe ich den
  Hinweis "Endzeit muss nach der Startzeit liegen" und das ungültige
  Fenster wird NICHT gespeichert.
- [ ] Given der Typ "Requirements" ist aktiv und hat keine Wochentage
  gewählt, when ich die Einstellungen betrachte, then ist erkennbar,
  dass "Requirements" jederzeit (immer) laufen darf.
- [ ] Given ich betrachte die Task-Steuerung, when die Seite angezeigt
  wird, then gibt es KEINE Möglichkeit, einen neuen Task-Typ anzulegen
  oder einen bestehenden zu löschen.

# Constraints

- Die Task-Typen werden variabel in der Datenbank gehalten, sodass
  künftig neue Typen ergänzt werden können. Das ist eine technische
  Vorgabe; für den Nutzer bleiben die fünf Typen oben sichtbar. Neue
  Typen entstehen über den Code, nicht über diese Oberfläche.

# Out of Scope

- Die tatsächliche Ausführungslogik des Workers (dass er Priorität und
  Zeitfenster beim Abarbeiten wirklich beachtet) — separates
  Requirement.
- Task-Typen selbst anlegen, umbenennen oder löschen über die
  Oberfläche.
- Task-Typ-Einstellungen pro Repo (hier gilt alles global).
- Mehrere Uhrzeit-Fenster pro Wochentag (nur eines pro Tag).
- Fenster über Mitternacht hinweg (Ende muss nach Anfang am selben Tag
  liegen).
