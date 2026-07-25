# appbaua

## Vision

The project's purpose and guiding principles are defined in
[delivery/vision.md](delivery/vision.md). When a requirement leaves a
gray area, decide it in line with those principles.

## DevOps

Deploy, environments, and promotion rules for this project are defined
in [delivery/devops.md](delivery/devops.md). Follow them exactly. In
particular: NEVER deploy to prod autonomously.

## Tech Stack

Languages, frameworks, commands, conventions, and the glossary for this
project are defined in [delivery/stack.md](delivery/stack.md). Follow
them exactly.

## Ideen

Der Worker schlägt einmal pro Tag genau eine neue Idee für dieses Repo
vor und legt sie als .md-Datei in [delivery/idea/](delivery/idea) ab;
umgesetzte Ideen liegen in `delivery/idea/done/`. Die inhaltliche
Richtung dafür steht — falls vorhanden — in
[delivery/idea-direction.md](delivery/idea-direction.md) und wird vom
Nutzer gepflegt. Ohne diese Datei schlägt der Worker frei vor.

## Areas

Geschäftsfunktions-Bereiche der App, zur Einordnung von Requirements.
Ein Requirement gehört in genau eine Area. Neue Areas werden hier
ergänzt.

- **Worker-Steuerung** — Konfiguration und Kontrolle des autonomen
  Workers: welche Repos er bearbeitet, in welcher Reihenfolge, aktiv/
  inaktiv, Task-Typen mit Zeiten, Hauptschalter. (req-001, req-002,
  req-003, req-012)
- **Worker-Ausführung** — Laufzeitverhalten des Workers: das Durchgehen
  von Repos × Task-Typen, Protokollierung der Schritte und deren Anzeige.
  (req-004)
