---
id: req-050
title: Favicon je Repo im Chat
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-21
changes: req-040
---

# Goal (Why)

Im Chat erkenne ich ein Repo heute nur am Namen. Mit dem Favicon der
jeweiligen App finde ich das richtige Repo auf einen Blick.

# Function (What)

Im Chat steht vor jedem Repo-Namen ein kleines Bild: in der Repo-Liste
links (iPad/Laptop, req-041), in jedem Eintrag der Repo-Auswahl (Handy)
und beim gerade gewählten Repo.

Das Bild ist das Favicon, das im Code des Repos auf `main` liegt — also
das Icon, das die App auf prod im Browser-Tab zeigt. Ändert sich das
Favicon auf `main`, zeigt der Chat spätestens am Folgetag das neue.

Hat ein Repo kein Favicon (oder ist es nicht lesbar), steht dort ein
Platzhalter gleicher Größe mit dem Anfangsbuchstaben des Repo-Namens als
Großbuchstabe, für alle Repos in derselben neutralen Farbe.

Alles andere am Chat (req-040, req-041, req-048, req-049) bleibt
unverändert.

# Acceptance Criteria

- [ ] Given "CellarVoice" hat auf `main` ein Favicon, when ich die
      Repo-Liste im Chat auf dem Laptop ansehe, then steht dieses
      Favicon vor "CellarVoice".
- [ ] Given "CellarVoice" hat auf `main` ein Favicon, when ich auf dem
      Handy die Repo-Auswahl öffne, then steht das Favicon vor dem
      Eintrag "CellarVoice".
- [ ] Given "CellarVoice" ist auf dem Handy gewählt, when ich die
      geschlossene Repo-Auswahl ansehe, then steht das Favicon vor
      "CellarVoice".
- [ ] Given "Wellarita" hat kein Favicon, when ich die Repo-Liste
      ansehe, then steht vor "Wellarita" ein Platzhalter mit "W".
- [ ] Given zwei Repos ohne Favicon, when ich ihre Platzhalter
      vergleiche, then haben beide dieselbe Farbe.
- [ ] Given das Favicon von "CellarVoice" liegt nur auf `dev`, nicht auf
      `main`, when ich die Repo-Liste ansehe, then steht dort noch das
      alte Favicon bzw. der Platzhalter.
- [ ] Given ein Repo hat eine kaputte Favicon-Datei, when ich die
      Repo-Liste ansehe, then erscheint NICHT das Symbol für ein
      fehlendes Bild, sondern der Platzhalter.

# Out of Scope

- Ein eigenes Bild je Repo hochladen oder festlegen
- Favicons außerhalb des Chats (Worker-Steuerung, Zustandsübersicht,
  Verlauf usw.)
- Das Favicon von der laufenden App im Netz holen
- Ein neues Favicon für appbaua selbst
