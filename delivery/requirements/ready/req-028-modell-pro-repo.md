---
id: req-028
title: Modell pro Repo wählbar (Fable 5 / Sonnet 5 / Opus 5 / Haiku)
app: appbaua
area: Worker-Steuerung
priority: normal
created: 2026-07-26
changes: req-001
---

# Goal (Why)

Ich will pro Repo festlegen, mit welchem Claude-Modell der Worker es
bearbeitet — damit ich das teure Opus gezielt dort einsetze, wo es sich
lohnt (z.B. der Rover / livinggardenkeeper), und den Rest mit dem
sparsamen Sonnet laufen lasse, um mein Rate-Limit zu schonen.

# Function (What)

In der Repo-Verwaltung (req-001) bekommt jeder Repo-Eintrag eine
Modell-Auswahl. Zur Wahl stehen jeweils die aktuellen Versionen:

- **Fable 5**
- **Sonnet 5** (Default)
- **Opus 5**
- **Haiku**

Die Wahl wird pro Repo gespeichert und ist dauerhaft gültig, bis ich sie
ändere. Ein Repo ohne ausdrückliche Wahl (insbesondere alle bestehenden)
verwendet **Sonnet 5** als Default — bestehende Repos laufen also weiter
wie bisher.

Wenn der Worker ein Repo bearbeitet, ruft er Claude Code mit dem für
dieses Repo eingestellten Modell auf. Eine geänderte Wahl greift ab dem
NÄCHSTEN Lauf dieses Repos; ein bereits laufender Schritt läuft mit
seinem Modell zu Ende.

# Acceptance Criteria

- [ ] Given ein Repo ohne ausdrückliche Modell-Wahl, when ich seinen
  Eintrag in der Repo-Verwaltung ansehe, then ist "Sonnet 5" als Modell
  ausgewählt.
- [ ] Given der Repo-Eintrag "livinggardenkeeper", when ich sein Modell
  auf "Opus 5" stelle, then ist diese Wahl gespeichert und nach einem
  Neuladen der Seite weiterhin "Opus 5".
- [ ] Given "livinggardenkeeper" ist auf "Opus 5" gestellt, when der
  Worker das nächste Mal einen Schritt für dieses Repo startet, then
  ruft er Claude Code für dieses Repo mit Opus 5 auf.
- [ ] Given ein Repo steht auf "Sonnet 5", when der Worker einen Schritt
  dafür startet, then läuft dieser mit Sonnet 5 (nicht mit dem Modell
  eines anderen Repos).
- [ ] Given ein für ein Repo laufender Schritt, when ich währenddessen
  das Modell dieses Repos ändere, then läuft der aktuelle Schritt mit
  seinem bisherigen Modell zu Ende und erst der nächste Lauf nutzt das
  neue Modell.
- [ ] Given die Modell-Auswahl eines Repo-Eintrags, when ich sie öffne,
  then sehe ich genau die Optionen Fable 5, Sonnet 5, Opus 5 und Haiku.

# Constraints

- Die Auswahl setzt das Modell, mit dem die Claude-Code-CLI aufgerufen
  wird (das bisher global gesetzte Modell wird pro Repo überschreibbar).
  Welches Modell tatsächlich lief, ist auf der Aktivitätskarte sichtbar
  (req-027).

# Out of Scope

- Ein pro Task-Typ (statt pro Repo) wählbares Modell — die Auswahl gilt
  je Repo für alle Task-Typen dieses Repos.
- Automatische Modell-Wahl nach Aufgaben-Schwere oder Kosten.
- Umschalten des Modells während eines laufenden Schritts.
