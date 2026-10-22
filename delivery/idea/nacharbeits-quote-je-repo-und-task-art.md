---
titel: "Nacharbeits-Quote — wie oft sitzt ein Worker-Ergebnis beim ersten Mal?"
datum: 2026-10-22
---

## Problem/Nutzen

Der Worker setzt Bugs und Requirements um; manche Ergebnisse sind sofort
tragfähig, andere brauchen einen Folge-Bug, einen Revert oder einen
zweiten Anlauf (sichtbar etwa an Commits wie "bug-040"/"bug-041", die
direkt auf Chat-Funktionen folgen). Heute lässt sich nur im Git-Log
mühsam erahnen, ob der Worker in einem Repo oder bei einer Task-Art
zuverlässig liefert oder ständig nachbessern muss.

Ohne diese Zahl bleibt "Vertrauen in den Worker" ein Bauchgefühl. Mit
ihr wird Verlässlichkeit messbar: Der Betreiber sieht, wo der Worker
stark ist, wo er schwächelt, und ob sich das über die Zeit bessert —
bevor er ihm mehr Verantwortung überlässt oder die App öffentlich
einsetzt.

Nutzen:

- **Verlässlichkeit** — Schwachstellen (Repo, Task-Art, Zeitfenster)
  werden früh sichtbar, statt erst beim dritten Folge-Bug aufzufallen.
- **Nachvollziehbarkeit** — jede Quote ist bis zu den zugrunde liegenden
  Einträgen aufklappbar: welche Arbeit galt als nachgebessert und warum.
- **Visualisierung** — Trend statt Logliste.

## Skizze

- **Definition "Nacharbeit"** (einfach, transparent, ohne Magie): Ein
  abgearbeitetes Requirement/Bug zählt als nachgearbeitet, wenn innerhalb
  eines festen Fensters (z. B. 14 Tage) ein Bug angelegt wird, der im
  Text auf diese Nummer verweist, oder ein Commit sie revertiert. Die
  Regel steht sichtbar auf der Seite, nicht im Code versteckt.
- **Erhebung**: reine Auswertung vorhandener Daten
  (`delivery/*/done/`, Bug-Texte mit Verweisen, Git-Historie). Kein
  neuer Worker-Task, keine Code-Änderung am Zielrepo.
- **Ansicht** in der Worker-App: Kachel je Repo mit Quote
  "beim ersten Mal korrekt" (z. B. 83 %), darunter ein Wochen-Sparkline
  und eine Aufschlüsselung nach Task-Art (Bug / Requirement). Klick auf
  eine Zahl öffnet die Liste der betroffenen Einträge samt Verweiskette
  (Requirement → Folge-Bug).
- **Schwellwert-Hinweis** (nur Anzeige, keine Automatik): fällt die
  Quote unter eine einstellbare Marke, färbt sich die Kachel und nennt
  den Grund. Der Worker ändert daraufhin nichts an seinem Verhalten; das
  Human-Gate bleibt unberührt.
- **Abgrenzung**: ergänzt `schritt-beleg-quality-gate-nachweis` (Beleg
  je Schritt) um die Sicht über Zeit; ersetzt kein Gate.
- **Offene Frage**: Verweise zwischen Bug und Ursprungs-Requirement
  müssten konsistent geschrieben werden (z. B. "Folge von req-NNN") —
  dafür genügt eine Konvention in der Bug-Vorlage.
