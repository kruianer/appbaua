# <Projektname>

Diese Datei wurde von der appbaua-Umstellung (req-012) angelegt, weil das
Repo noch keine hatte. Sie ist ein Startpunkt — passe sie an und ersetze
die Platzhalter. Eine bereits vorhandene CLAUDE.md wird von der
Umstellung nie angefasst.

## Vision

Zweck und Leitprinzipien dieses Projekts stehen in
[delivery/vision.md](delivery/vision.md). Lässt ein Requirement eine
Grauzone offen, entscheide sie im Sinne dieser Prinzipien. Datei noch
nicht vorhanden? Lege sie mit dem Skill `setup-vision` an.

## DevOps

Deploy, Umgebungen und Promotion-Regeln stehen in
[delivery/devops.md](delivery/devops.md). Befolge sie exakt. Insbesondere:
NIEMALS autonom nach prod deployen. Datei noch nicht vorhanden? Lege sie
mit dem Skill `setup-devops` an.

## Tech Stack

Sprachen, Frameworks, Kommandos, Konventionen und das Glossar stehen in
[delivery/stack.md](delivery/stack.md). Befolge sie exakt. Datei noch
nicht vorhanden? Lege sie mit dem Skill `setup-stack` an.

## Ideen

Der Worker schlägt einmal pro Tag genau eine neue Idee für dieses Repo
vor und legt sie als .md-Datei in [delivery/idea/](delivery/idea) ab;
umgesetzte Ideen liegen in `delivery/idea/done/`. Die inhaltliche
Richtung dafür steht — falls vorhanden — in
[delivery/idea-direction.md](delivery/idea-direction.md) und wird vom
Nutzer gepflegt (Skill `setup-idea-direction`). Ohne diese Datei schlägt
der Worker frei vor.

## Areas

Geschäftsfunktions-Bereiche der App, zur Einordnung von Requirements.
Ein Requirement gehört in genau eine Area. Neue Areas werden hier
ergänzt.

- Noch keine Area definiert — die erste entsteht mit dem ersten
  Requirement.
