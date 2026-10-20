---
id: req-039
title: Untere Navigation mit fünf Plätzen und Chat in der Mitte
app: appbaua
area: Arbeitsplatz
priority: normal
created: 2026-10-17
changes: req-005
---

# Goal (Why)

Die untere Leiste trägt heute sechs gleich aussehende Menüpunkte. Der
Chat wird der Ort, an dem ich künftig arbeite, und soll deshalb auf
Anhieb als Hauptsache erkennbar sein — nicht als siebter Eintrag in
einer Reihe.

# Function (What)

Die untere Navigation hat fünf Plätze, von links nach rechts:
Aktivität, Verlauf, Chat, Repos, Mehr.

Der Chat sitzt in der Mitte und ist von den anderen vier abgesetzt: sein
Symbol steht in einem Kreis und ist größer als die übrigen Symbole.

"Mehr" öffnet eine Liste mit den drei Menüpunkten, die keinen eigenen
Platz mehr haben: Zustand, Tasks, Einstellungen. Ein Tippen darauf
wechselt in den jeweiligen Menüpunkt und schließt die Liste.

Dies ersetzt die Leiste aus req-005 (Aktivität, Zustand, Verlauf, Repos,
Tasks, Einstellungen) — es entsteht keine zweite Leiste daneben. Die
Menüpunkte selbst und ihr Inhalt bleiben unverändert; nur ihre
Erreichbarkeit ändert sich. Aktivität bleibt die Startansicht.

# Acceptance Criteria

- [x] Given ich öffne die App, when ich die untere Leiste ansehe, then
      sehe ich genau fünf Plätze.
- [x] Given ich öffne die App, when ich die untere Leiste von links nach
      rechts lese, then lauten die Beschriftungen "Aktivität",
      "Verlauf", "Chat", "Repos", "Mehr".
- [x] Given ich öffne die App, when ich die untere Leiste ansehe, then
      ist das Chat-Symbol von einem Kreis umrandet.
- [x] Given ich öffne die App, when ich das Chat-Symbol mit den anderen
      vergleiche, then ist es sichtbar größer als diese.
- [x] Given ich bin in einem beliebigen Menüpunkt, when ich auf "Mehr"
      tippe, then erscheint eine Liste mit genau drei Einträgen:
      "Zustand", "Tasks", "Einstellungen".
- [x] Given die "Mehr"-Liste ist offen, when ich auf "Zustand" tippe,
      then sehe ich die Zustandsübersicht und die Liste ist geschlossen.
- [x] Given die "Mehr"-Liste ist offen, when ich daneben tippe, then
      ist die Liste geschlossen und der Menüpunkt hat sich nicht
      geändert.
- [x] Given ich öffne die App neu, when die Startansicht erscheint,
      then ist der Menüpunkt "Aktivität" aktiv.
- [x] Given ich bin im Menüpunkt "Zustand" (über "Mehr" erreicht), when
      ich die untere Leiste ansehe, then erscheint "Zustand" NICHT als
      sechster Platz in der Leiste.

# Out of Scope

- Der Inhalt des Chat-Menüpunkts — das ist req-040. Dieses Requirement
  bringt nur den Platz in der Leiste.
- Jede Änderung am Inhalt von Aktivität, Verlauf, Repos, Zustand, Tasks
  und Einstellungen.
- Ein Umsortieren oder Anpassen der Menüpunkte durch den Nutzer.
- Eine zusätzliche Navigation am oberen Rand oder eine Seitenleiste.
