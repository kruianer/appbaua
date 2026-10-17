---
id: req-045
title: Feedback-Formular in der App
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-10-17
---

# Goal (Why)

Wenn mir an einer App etwas auffällt, will ich es sofort loswerden — mit
dem Gerät, das ich gerade in der Hand habe. Heute müsste ich dafür an
den Rechner, eine Datei anlegen und sie ins richtige Repo pushen. Bis
dahin ist der Eindruck weg.

# Function (What)

In appbaua kann ich ein Feedback erfassen: Repo auswählen, Text
schreiben, abschicken.

Das Feedback landet als Datei in `delivery/feedback/ready/` des
gewählten Repos, wo der Worker es beim nächsten Lauf findet (req-043).

Mehr braucht es nicht — kein Titel, keine Kategorie, keine Einstufung.
Je weniger auszufüllen ist, desto eher schreibe ich etwas.

# Acceptance Criteria

- [ ] Given ich bin in appbaua, when ich ein Feedback geben will, then
      finde ich dafür eine Stelle in der App.
- [ ] Given ich öffne das Feedback-Formular, when es erscheint, then
      kann ich ein Repo auswählen und einen Text schreiben.
- [ ] Given ich habe "CellarVoice" gewählt und "Die Startseite wirkt
      unruhig" geschrieben, when ich abschicke, then liegt im Repo
      CellarVoice eine neue Datei in `delivery/feedback/ready/`.
- [ ] Given ich habe ein Feedback abgeschickt, when ich die Bestätigung
      lese, then sehe ich, in welchem Repo es gelandet ist.
- [ ] Given das Textfeld ist leer, when ich abschicken will, then wird
      nichts abgeschickt.
- [ ] Given mein Feedback ist abgeschickt, when ich das Formular erneut
      öffne, then ist das Textfeld leer.
- [ ] Given das Repo ist nicht erreichbar, when ich abschicke, then
      sehe ich, dass es nicht geklappt hat, und mein Text ist NICHT
      verloren.
- [ ] Given ich gebe ein Feedback auf dem iPhone, when ich das Formular
      ansehe, then kann ich Repo und Text ohne seitliches Schieben
      erreichen.

# Constraints

- Das Feedback wird in das Ziel-Repo geschrieben, nicht in appbauas
  eigene Datenbank — der Worker arbeitet aus dem Repo heraus. Der Weg
  dorthin (klonen, schreiben, nach `dev` pushen) existiert bereits für
  die Umstellung auf den appbaua-Standard (req-012).

# Out of Scope

- Was der Worker aus einem Feedback macht — das ist req-043.
- Ein Bild oder Bildschirmfoto an ein Feedback anhängen.
- Eine Liste meiner bisherigen Feedbacks und was daraus wurde.
- Feedback zu einem bestimmten Element per Klick darauf.
- Ein Formular für Bugs oder Requirements. Dafür gibt es die Skills
  `capture-bug` und `capture-requirement`.
