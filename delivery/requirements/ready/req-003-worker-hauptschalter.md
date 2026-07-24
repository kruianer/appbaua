---
id: req-003
title: Globaler Worker-Hauptschalter (an/aus)
app: appbaua
area: Worker-Steuerung
priority: high
created: 2026-07-24
---

# Goal (Why)

Ich will den Worker mit einem einzigen Schalter global stoppen oder
laufen lassen können, ohne meine Prioritäts- und Zeit-Einstellungen zu
verändern — damit ich ihn kurzfristig anhalten kann und danach wieder
mit genau denselben Einstellungen weiterläuft.

# Function (What)

Oben in der Task-Steuerung gibt es einen gut sichtbaren Hauptschalter
"Worker" mit zwei Zuständen: "an" und "aus". Der Zustand wird
gespeichert und bleibt nach Neuladen erhalten. Bei "aus" zeigt die
Oberfläche klar an, dass der Worker gestoppt ist; bei "an", dass er nach
den gesetzten Einstellungen läuft. Der Schalter ändert KEINE der
Task-Typ-Einstellungen (Priorität, Aktiv-Flags, Zeiten) — er ist nur der
globale An/Aus.

Hinweis (bewusst): Dieses Requirement deckt nur den gespeicherten
Zustand und dessen Anzeige ab. Dass der Worker beim Zustand "aus"
tatsächlich pausiert, ist Teil der Worker-Ausführungslogik und Out of
Scope (siehe unten).

# GUI

- Kein eigenes Mockup. Der Hauptschalter lehnt sich stilistisch an das
  bestehende Nocturne-Design und die Toggle-Bedienung aus req-001/req-002
  an; er sitzt sichtbar oben in der Task-Steuerung.
- Zielgerät: primär Smartphone (Hochformat), responsive — analog req-001.

# Acceptance Criteria

- [ ] Given ich öffne die Task-Steuerung, when die Seite lädt, then sehe
  ich oben einen Hauptschalter "Worker" mit erkennbarem Zustand ("an"
  oder "aus").
- [ ] Given der Worker-Hauptschalter steht auf "an", when ich ihn auf
  "aus" schalte, then zeigt die Oberfläche "Worker gestoppt" und der
  Zustand bleibt auch nach Neuladen der Seite "aus".
- [ ] Given der Worker-Hauptschalter steht auf "aus", when ich ihn auf
  "an" schalte, then zeigt die Oberfläche "läuft nach den Einstellungen"
  und der Zustand bleibt nach Neuladen "an".
- [ ] Given ich habe für einen Task-Typ Priorität und Zeiten gesetzt,
  when ich den Worker-Hauptschalter auf "aus" und wieder auf "an"
  schalte, then sind diese Task-Typ-Einstellungen unverändert.

# Out of Scope

- Die tatsächliche Wirkung des Schalters auf einen laufenden Worker
  (Pausieren/Fortsetzen der Ausführung) — Teil der Worker-Ausführungs-
  logik, separates Requirement.
- Zeitgesteuertes automatisches An/Aus des Workers.
- Ein Hauptschalter pro Repo (hier gilt er global).
