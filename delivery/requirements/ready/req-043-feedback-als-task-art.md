---
id: req-043
title: Feedback als dritte Task-Art
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-10-17
---

# Goal (Why)

Nicht alles, was mir an einer App auffällt, ist ein Fehler oder ein
fertig gedachter Wunsch. Oft ist es ein Eindruck: etwas gefällt mir,
etwas stört, etwas fehlt. Heute habe ich dafür keinen Platz — ich müsste
es zu einem Bug oder Requirement zurechtbiegen, was es nicht ist.

# Function (What)

Neben "Bugs" und "Requirements" gibt es die Task-Art "Feedback".

Ein Feedback ist freier Text. Es sagt nicht, was zu tun ist — es ist
ein Eindruck, den ich hinterlasse.

Der Worker liest ein Feedback und entscheidet selbst, was daraus wird:
ein Requirement, ein Bug, eine Änderung an der Vision, eine Notiz — oder
nichts. Diese Entscheidung gehört ihm; das Feedback schreibt sie nicht
vor.

Was er daraus gemacht hat, schreibt er in seinen Verlaufseintrag. Danach
wandert das Feedback nach `done/`, wie ein abgearbeiteter Bug.

Feedbacks liegen im Ziel-Repo unter `delivery/feedback/`, mit denselben
Ordnern wie Bugs und Requirements.

# Acceptance Criteria

- [ ] Given ich öffne den Menüpunkt "Tasks", when ich die Liste ansehe,
      then steht dort eine Task-Art "Feedback".
- [ ] Given in einem Repo liegt `delivery/feedback/ready/fb-001-farben.md`
      und die Task-Art ist aktiv, when der Worker das Repo an die Reihe
      nimmt, then bearbeitet er diese Datei.
- [ ] Given der Worker hat ein Feedback bearbeitet, when ich den Verlauf
      ansehe, then steht dort der Dateiname des Feedbacks.
- [ ] Given der Worker hat ein Feedback bearbeitet, when ich seinen
      Verlaufseintrag lese, then steht dort, was er daraus gemacht hat.
- [ ] Given der Worker hat ein Feedback bearbeitet, when ich ins Repo
      sehe, then liegt die Datei in `delivery/feedback/done/`.
- [ ] Given `delivery/feedback/ready/` ist leer, when der Worker das
      Repo an die Reihe nimmt, then entsteht KEIN Verlaufseintrag für
      Feedback.
- [ ] Given ein Feedback lautet nur "Die Startseite wirkt unruhig",
      when der Worker es bearbeitet, then entsteht daraus KEIN Code —
      sondern höchstens ein Requirement oder ein Bug für später.
- [ ] Given die Task-Art "Feedback" ist auf inaktiv gestellt, when der
      Worker läuft, then bearbeitet er keine Feedbacks.

# Constraints

- Ein Feedback ändert keinen Code. Es erzeugt höchstens Arbeit für
  später (ein Requirement, einen Bug, eine Notiz).

# Out of Scope

- Das Formular, über das ich ein Feedback erfasse — das ist req-045.
  Dieses Requirement macht nur die Task-Art.
- Eine Obergrenze dafür, wie viel Arbeit aus Feedbacks entstehen darf —
  das ist req-044.
- Eine Antwort des Workers an mich (Rückfrage, Dialog). Ein Feedback ist
  einseitig.
- Feedback zu einem bestimmten Bildschirm oder Element per Klick.
