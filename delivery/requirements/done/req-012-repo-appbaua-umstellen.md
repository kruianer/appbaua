---
id: req-012
title: Repo auf appbaua umstellen — Skills und delivery-Struktur ausrollen
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-07-25
---

# Goal (Why)

Ich will ein Repo aus der Repo-Verwaltung mit einem Klick
"appbaua-fähig" machen — es bekommt alle Claude-Skills und die leere
delivery-Ordnerstruktur, die der autonome Worker braucht —, damit ich
neue Repos schnell aufsetzen und bestehende auf den neuesten Skill-Stand
bringen kann, ohne Dateien von Hand zu kopieren.

# Function (What)

In der Repo-Verwaltung (req-001) hat jeder Repo-Eintrag einen Button
"Auf appbaua umstellen/aktualisieren". Beim Klick bringt die App das
Zielrepo auf den appbaua-Standard und pusht das Ergebnis auf dessen
`dev`-Branch.

Als Quelle dient der aktuelle Stand des appbaua-Repos (frisch geholt).
Die Funktion liest dort ZUR LAUFZEIT, welche Skills und delivery-Ordner
es gibt — nichts ist fest verdrahtet; kommen später Skills oder Ordner
hinzu, werden sie automatisch mit ausgerollt.

Ins Zielrepo geschrieben wird:
1. Alle Skills aus `.claude/skills/` — beim Update vorhandene
   gleichnamige Skills überschrieben (neuester Stand); Skills, die es
   nur im Zielrepo gibt, bleiben unberührt (nichts wird gelöscht).
2. Die komplette delivery-Ordnerstruktur (alle Ordner unter `delivery/`
   inkl. Unterordner) als LEERE Struktur; fehlende Ordner werden
   angelegt, vorhandene inkl. ihres Inhalts bleiben unberührt.
3. Eine `CLAUDE.md`, aber NUR wenn im Zielrepo noch keine existiert; ist
   schon eine da, wird sie nicht angefasst.

Die Instruktions-Dateien im delivery-Root (z.B. devops.md, stack.md,
vision.md, idea-direction.md, deploy-setup.md) werden NIE kopiert und
NIE überschrieben — sie sind pro Repo verschieden und werden dort separat
gepflegt.

Die Aktion ist wiederholbar (idempotent): erneutes Ausführen führt zum
selben Zustand. Schlägt ein Schritt fehl (Zielrepo unerreichbar, kein
Schreib-/Push-Zugriff), wird die ganze Umstellung abgebrochen, NICHTS
gepusht, und eine konkrete Fehlermeldung angezeigt. Fehlt im Zielrepo ein
`dev`-Branch, wird er vom Default-Branch abgezweigt und dorthin gepusht.

# GUI

- Kein eigenes Mockup. Der Button und die Rückmeldung lehnen sich an die
  bestehende Repo-Verwaltung (req-001, Nocturne-Design) an.
- Während der Umstellung zeigt der Button/Eintrag einen Laufindikator
  ("Wird umgestellt …"); danach eine Ergebnismeldung mit knapper
  Zusammenfassung (Anzahl kopierter Skills, Anzahl angelegter Ordner,
  Ziel-Branch) bzw. die Fehlermeldung.

# Acceptance Criteria

- [ ] Given das Repo "kruianer/leer-repo" ist in der Liste und hat weder
  Skills noch delivery-Ordner, when ich auf "Auf appbaua umstellen"
  klicke und die Umstellung erfolgreich ist, then liegen auf dem
  `dev`-Branch von "kruianer/leer-repo" alle Skills aus `.claude/skills/`
  und die leere delivery-Ordnerstruktur.
- [ ] Given appbaua hat 6 Skills und 5 delivery-Ordner, when die
  Umstellung erfolgreich endet, then sehe ich eine Meldung, die genau
  diese Anzahlen und den Ziel-Branch "dev" nennt.
- [ ] Given das Zielrepo hat bereits eine `CLAUDE.md`, when ich die
  Umstellung ausführe, then bleibt diese `CLAUDE.md` unverändert.
- [ ] Given das Zielrepo hat noch keine `CLAUDE.md`, when die Umstellung
  erfolgreich endet, then existiert im Zielrepo eine neue `CLAUDE.md`.
- [ ] Given im Zielrepo liegt eine ältere Version des Skills
  "capture-bug" und eine vom Nutzer angepasste `delivery/stack.md`, when
  ich "aktualisieren" ausführe, then ist "capture-bug" auf den
  appbaua-Stand überschrieben, aber `delivery/stack.md` unverändert.
- [ ] Given im Zielrepo existiert bereits der Ordner
  `delivery/requirements/ready` mit einer Datei darin, when ich die
  Umstellung ausführe, then bleibt diese Datei erhalten (der Ordner wird
  nicht geleert).
- [ ] Given das Zielrepo ist nicht erreichbar oder ich habe keinen
  Push-Zugriff, when ich die Umstellung ausführe, then wird NICHTS auf
  das Zielrepo gepusht und ich sehe eine konkrete Fehlermeldung.
- [ ] Given das Zielrepo hat einen Skill "eigener-skill", den appbaua
  nicht kennt, when ich "aktualisieren" ausführe, then bleibt
  "eigener-skill" im Zielrepo erhalten (er wird NICHT gelöscht).

# Constraints

- Der Zugriff auf die Zielrepos erfolgt über den zentral hinterlegten
  GitHub-Token (wie in req-001) — es werden private GitHub-Repos
  bearbeitet.

# Out of Scope

- Kopieren/Überschreiben der Instruktions-Dateien im delivery-Root
  (devops.md, stack.md, vision.md, idea-direction.md, deploy-setup.md).
- Kopieren der appbaua-eigenen Inhalte der delivery-Ordner (z.B. die
  Requirements req-001..011, Ideen, Reviews) — es wird nur die leere
  Struktur ausgerollt.
- Einbringen per Pull Request oder ein Human-Gate im Zielrepo — es wird
  direkt auf dessen `dev` gepusht.
- Automatisches Umstellen ohne Klick (kein eigener Worker-Task, keine
  Automatik beim Hinzufügen).
- Ein Verlaufs-/Log-Eintrag für die Umstellung (nur Sofort-Rückmeldung
  am Button).
- Löschen/Spiegeln von Skills, die es nur im Zielrepo gibt.
