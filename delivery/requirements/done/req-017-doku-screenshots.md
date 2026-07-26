---
id: req-017
title: Doku-Screenshots — Worker bebildert die User-Doku per Playwright
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-016
---

# Goal (Why)

Ich will, dass die Benutzer-Dokumentation nicht nur Text ist, sondern
echte Abbildungen der App zeigt — damit Nutzer sofort sehen, wovon die
Doku spricht.

# Function (What)

Erweitert den Doku-Task aus req-016. Beim Erzeugen/Aktualisieren der Doku
macht der Worker per Playwright Screenshots der laufenden App und bindet
sie an den passenden Stellen in die Doku-Seiten ein.

- Die Screenshots entstehen gegen die laufende dev-Umgebung der App
  (dev.appbaua.com), nicht durch lokales Starten der App.
- Die Bilder werden zur Doku im Repo abgelegt (unter `site/user-docs/`,
  wie die übrige Doku) und mit ihr gepusht/deployt.
- Schlägt ein Screenshot fehl (App nicht erreichbar, Seite braucht Login,
  Seite kaputt), wird die Doku trotzdem gebaut — die betroffene Stelle
  bleibt ohne Bild, und der Verlauf/Bericht vermerkt den fehlenden
  Screenshot. Ein fehlender Screenshot bricht den Doku-Lauf NICHT ab.

# Acceptance Criteria

- [ ] Given die dev-Umgebung der App ist erreichbar und der Doku-Task
  läuft, when die Doku erzeugt wird, then enthält mindestens eine
  Doku-Seite einen per Playwright erzeugten Screenshot der App, der mit
  der Doku ins Repo gepusht wird.
- [ ] Given die dev-Umgebung ist für einen bestimmten Screenshot nicht
  erreichbar, when der Doku-Task läuft, then wird die Doku trotzdem
  gebaut und im Verlauf/Bericht steht ein Vermerk über den fehlenden
  Screenshot.
- [ ] Given ein Screenshot ist fehlgeschlagen, when ich die betroffene
  Doku-Seite ansehe, then bricht die Seite nicht (kein kaputtes Bild
  blockiert den Inhalt) und der übrige Doku-Inhalt ist vorhanden.

# Constraints

- Screenshots werden gegen die dev-App-Umgebung erstellt; deren
  Erreichbarkeit ist Voraussetzung für Bilder, aber nicht für die Doku
  selbst.

# Out of Scope

- Videos der App (kann später folgen; dieses Requirement macht
  Screenshots).
- Screenshots gegen prod oder eine lokal gestartete App.
- Automatisches Auswählen "welche Seite wird wo bebildert" über eine
  Konfigurationsoberfläche — der Worker entscheidet die Platzierung im
  Sinne der Doku.
