---
name: setup-idea-direction
description: Legt fuer THIS project die Richtung fest, in die der autonome Worker seine Ideen-Vorschlaege lenken soll — Themen, Schwerpunkte und explizite No-Gos. Schreibt delivery/idea-direction.md und verlinkt sie aus CLAUDE.md, damit der Ideen-Task (req-011) sie bei jedem Lauf beruecksichtigt. Nutze diesen Skill, wenn der Nutzer die inhaltliche Ausrichtung der automatisch vorgeschlagenen Ideen definieren oder anpassen will (z.B. "leg die Ideen-Richtung fest", "der Worker soll Ideen in Richtung X vorschlagen", "keine Ideen zu Y", "adaptiere die Ideen-Richtung").
---

# Ideen-Richtung des Projekts festlegen

Du hilfst dem Nutzer, die inhaltliche Richtung fuer die automatisch
vom Worker vorgeschlagenen Ideen (Task-Typ "Ideen", req-011) zu
definieren, und schreibst sie als bindende Vorgabe in
`delivery/idea-direction.md`. Diese Datei ist Kontext, den der Worker
beim Ideen-Task liest: Sie lenkt seine Vorschlaege in die gewuenschte
Richtung. Ohne sie schlaegt der Worker frei Ideen vor; mit ihr bleiben
die Vorschlaege auf Kurs.

Halte es kurz — hoechstens eine Bildschirmseite. Die Datei ist ein
Kompass fuer Ideen, kein Konzept-Dokument.

Sprache: Fuehre den Dialog UND schreibe `delivery/idea-direction.md` in
der Sprache, in der der Nutzer mit dir spricht. Ausnahme (Maschinen-
Vertrag): Abschnitts-Ueberschriften, Ordnerpfade und der Dateiname
`delivery/idea-direction.md` bleiben unveraendert, egal in welcher
Sprache.

## Flow

### 1. Intake

Lass den Nutzer die gewuenschte Richtung frei beschreiben. Extrahiere,
mit hoechstens 2-3 Fragen:
- **Schwerpunkte:** In welche Richtung sollen Ideen gehen? (z.B.
  Nutzerfreundlichkeit, Automatisierung, Performance, neue Zielgruppen,
  Monetarisierung, Sicherheit.) Zieh konkrete Schwerpunkte heraus, keine
  Allgemeinplaetze.
- **Kontext/Zielbild:** Wohin soll sich das Projekt entwickeln? Woran
  misst der Nutzer eine "gute" Idee?
- **No-Gos:** Wozu sollen KEINE Ideen kommen? (z.B. "keine neuen
  Bezahlfeatures", "nichts, was die Architektur umbaut".) Schlage 2-3
  plausible No-Gos selbst vor und lass den Nutzer entscheiden — sie
  schuetzen davor, dass der Worker in ungewollte Richtungen vorschlaegt.

### 2. Schreiben

Schreibe `delivery/idea-direction.md` im Template-Format unten. Existiert
die Datei schon, zeige dem Nutzer die Aenderungen, bevor du ueberschreibst
(dies ist ein Adaptions-Skill: der Nutzer passt die Richtung von Zeit zu
Zeit an).

### 3. Verlinken aus CLAUDE.md

`delivery/idea-direction.md` wird NICHT automatisch vom Worker geladen —
sie muss aus der CLAUDE.md referenziert sein, sonst ignoriert der Worker
sie. Stelle sicher, dass die CLAUDE.md des Repos einen Abschnitt
`## Ideen-Richtung` mit einem Verweis enthaelt:

```markdown
## Ideen-Richtung

Die inhaltliche Richtung fuer automatisch vorgeschlagene Ideen (Task-Typ
"Ideen", req-011) ist in [delivery/idea-direction.md](delivery/idea-direction.md)
definiert. Beruecksichtige sie beim Ideen-Task.
```

Fehlt der Abschnitt, fuege ihn hinzu. Verweist er schon dorthin, lass ihn
stehen. Existiert keine CLAUDE.md, biete an, eine mit diesem Abschnitt
anzulegen.

### 4. Bestaetigen

Zeige dem Nutzer die geschriebene `delivery/idea-direction.md` vollstaendig
und bestaetige, dass der CLAUDE.md-Verweis steht. Committe oder pushe
NICHT, ausser der Nutzer bittet darum — dies ist eine Konventions-
Aenderung, die er zuerst pruefen sollte.

## Template

```markdown
---
project: <repo-name>
---

# Ideen-Richtung

Bindende Vorgabe fuer den Ideen-Task des autonomen Workers (req-011).
Er beruecksichtigt sie bei jedem Ideen-Vorschlag.

## Schwerpunkte

- <konkreter Schwerpunkt 1, z.B. "Bedienung auf dem Smartphone weiter vereinfachen">
- <konkreter Schwerpunkt 2>
- <...>

## Zielbild

<1-3 Saetze: wohin sich das Projekt entwickeln soll; woran eine gute
Idee gemessen wird.>

## No-Gos

- <wozu ausdruecklich KEINE Ideen kommen sollen>
- <...>
```

## Was du NIE tust

- Die Datei zu einem langen Konzept aufblaehen — sie ist ein kurzer
  Ideen-Kompass, kein Strategiepapier.
- `delivery/idea-direction.md` unverlinkt aus der CLAUDE.md lassen —
  unverlinkt liest der Worker sie nie.
- Eine bestehende `delivery/idea-direction.md` ohne Diff ueberschreiben.
- Committen oder pushen, ohne dass der Nutzer darum bittet.
- Konkrete Ideen SELBST erfinden — dieser Skill legt nur die RICHTUNG
  fest; die einzelnen Ideen schlaegt spaeter der Worker vor.
