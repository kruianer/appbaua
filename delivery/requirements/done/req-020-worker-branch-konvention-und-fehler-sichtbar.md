---
id: req-020
title: Worker respektiert die Branch-Konvention des Zielrepos und macht Vorbereitungs-Fehler sichtbar
app: appbaua
area: Worker-Ausführung
priority: high
created: 2026-07-26
---

# Goal (Why)

Ich will, dass der Worker auch Repos bearbeitet, die bewusst keinen
`dev`-Branch nutzen, und dass ich sofort im Verlauf sehe, wenn er an einem
Repo scheitert. Aktuell bleibt ein Repo mit abweichender Branch-Konvention
(z.B. livinggardentwin: dev = aktueller `feature/*`-Branch, kein
`dev`-Branch) unbearbeitet, und der Worker geht ohne sichtbaren Grund
sofort in Pause — es entsteht kein Verlaufs-Eintrag.

# Function (What)

Zwei zusammenhängende Änderungen am Laufzeitverhalten:

1. **Branch-Konvention pro Repo aus dessen devops.md:** Der Worker legt
   nicht mehr fest auf einem `dev`-Branch ab, sondern ermittelt für jedes
   Zielrepo den zu verwendenden Branch aus der `## Environments`-Tabelle
   der devops.md dieses Repos (die Zeile für die dev-Umgebung). Nennt sie
   einen konkreten Branch (z.B. `dev`), nutzt er den. Ist als
   dev-"Branch" eine Konvention statt eines festen Namens hinterlegt
   (z.B. "aktueller `feature/*`-Branch"), committet der Worker auf den
   aktuell ausgecheckten Branch dieses Repos, statt einen `dev`-Branch zu
   erzwingen oder anzulegen. Fehlt eine devops.md oder eine
   Environments-Angabe, bleibt das bisherige Verhalten (dev, sonst
   Default-Branch — req-013).

2. **Vorbereitungs-Fehler sichtbar im Verlauf:** Scheitert das Vorbereiten
   eines Repos (Klonen, Checkout, Branch-Ermittlung) oder das Pushen,
   entsteht ein sichtbarer Fehler-Eintrag im Verlauf mit Repo-Name und
   Grund — nicht nur eine Konsolenausgabe. Der Worker darf wegen eines
   einzelnen scheiternden Repos nicht ohne sichtbaren Grund in Pause
   gehen.

# Acceptance Criteria

- [ ] Given ein Zielrepo, dessen devops.md als dev-Umgebung einen
  konkreten Branch "dev" nennt, when der Worker es bearbeitet, then
  committet er auf `dev` (unverändertes Verhalten für Standard-Repos).
- [ ] Given ein Zielrepo, dessen devops.md als dev-Umgebung "aktueller
  feature/*-Branch, kein dev-Branch" festlegt, when der Worker es
  bearbeitet, then committet er auf den aktuell ausgecheckten Branch und
  legt KEINEN `dev`-Branch an.
- [ ] Given ein Zielrepo mit offenen Bugs/Requirements in `ready/` und
  abweichender Branch-Konvention, when der Worker seinen Durchlauf macht,
  then wird die Arbeit tatsächlich bearbeitet (nicht uebersprungen, kein
  sofortiges Pausieren ohne Grund).
- [ ] Given das Vorbereiten eines Repos scheitert (z.B. Klonen/Checkout/
  Push), when der Worker den Schritt versucht, then erscheint im Verlauf
  ein Fehler-Eintrag, der das betroffene Repo und den Grund nennt.
- [ ] Given ein einzelnes Repo scheitert beim Vorbereiten, when der
  Worker weiterläuft, then bearbeitet er die übrigen Repos weiter und
  pausiert nicht wortlos.

# Constraints

- Die devops.md jedes Repos ist die verbindliche Quelle der
  Branch-/Umgebungs-Konvention (sie existiert bereits pro Repo, angelegt
  über setup-devops). Beispiel-Abweichung: livinggardentwin nutzt
  bewusst keinen `dev`-Branch.

# Out of Scope

- Deploy/Promotion-Verhalten der Zielrepos (dieses Requirement betrifft
  nur, auf welchen Branch der Worker committet und dass Fehler sichtbar
  werden).
- Ein pro Repo in der App einstellbares Branch-Feld — die Quelle ist die
  devops.md, nicht die Oberfläche.
- Das Test-Gate vor "done" (separat, req-019).
