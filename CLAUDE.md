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

## Security

Der Worker prüft dieses Repo höchstens einmal pro Tag auf Sicherheit
(Task-Typ "Security", req-014): Zugriff & Erreichbarkeit, Datenschutz &
Datenhaltung, Backup & Wiederherstellung, Abhängigkeiten & bekannte
Lücken. Das SOLL dafür steht — falls vorhanden — in
[delivery/security.md](delivery/security.md) (angelegt über den Skill
`setup-security`); ohne diese Datei prüft er nach allgemeinen
Best-Practices. Findet er etwas, legt er einen Bericht in
`delivery/security/` ab; findet er nichts, entsteht keine Datei. Der
Task ändert keinen Code.

## Doku-Site

Der Worker pflegt die Benutzer-Dokumentation dieses Repos höchstens
einmal pro Tag als mehrseitige Website (Task-Typ "Doku", req-016). Er
leitet den Inhalt aus `delivery/requirements/done/` und dem Code ab und
aktualisiert die Seiten unter `site/user-docs/` inkrementell — er baut
sie nicht bei jedem Lauf neu. Die Grundvorgaben (Ort der Design-Vorlage,
Deploy-Ziele für dev und prod) stehen — falls vorhanden — in
[delivery/doc-site.md](delivery/doc-site.md) (angelegt über den Skill
`setup-doc-site`). Ohne diese Datei bzw. ohne vorhandene Design-Vorlage
tut der Doku-Task nichts. Der Push auf `dev` löst den dev-Deploy aus;
nach prod geht die Doku nur über dasselbe Human-Gate wie der Code
(siehe [delivery/devops.md](delivery/devops.md)).

Vor dem Schreiben bebildert der Worker die Doku (req-017): er macht per
Playwright Screenshots der laufenden dev-Umgebung der App — die dev-URL
liest er aus dem `## Environments`-Abschnitt der
[delivery/devops.md](delivery/devops.md) des Repos — und legt sie unter
`site/user-docs/assets/screenshots/` ab, wo sie mit der Doku gepusht und
deployt werden. Screenshots werden nur gegen dev gemacht, nie gegen prod.
Ein fehlgeschlagener Screenshot bricht den Doku-Lauf NICHT ab: die Doku
entsteht ohne dieses Bild, und der Verlauf vermerkt die betroffene Seite.

## Areas

Geschäftsfunktions-Bereiche der App, zur Einordnung von Requirements.
Ein Requirement gehört in genau eine Area. Neue Areas werden hier
ergänzt.

- **Worker-Steuerung** — Konfiguration und Kontrolle des autonomen
  Workers: welche Repos er bearbeitet, in welcher Reihenfolge, aktiv/
  inaktiv, Task-Typen mit Zeiten, Hauptschalter. (req-001, req-002,
  req-003, req-012, req-013, req-018, req-028)
- **Worker-Ausführung** — Laufzeitverhalten des Workers: das Durchgehen
  von Repos × Task-Typen, Protokollierung der Schritte und deren Anzeige.
  (req-004, req-014, req-015, req-016, req-017, req-019, req-020, req-021,
  req-022, req-025, req-026, req-027)
- **Zugang & Sicherheit** — Zugangsschutz und externe Erreichbarkeit der
  Worker-App: Anmeldung, Sitzungen, sicherer Zugang von außen. (req-023,
  req-024)
