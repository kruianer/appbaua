---
name: setup-security
description: Legt fuer THIS project die Sicherheits-Vorgaben fest, gegen die der autonome Worker beim Security-Task (req-014) prueft — Erreichbarkeit (nur intern im WLAN vs. von aussen), HTTPS-Pflicht, Zugriffskreis (nur ich vs. andere), Backup-Erwartung und besondere Datenschutz-Anforderungen. Schreibt delivery/security.md und verlinkt sie aus CLAUDE.md, damit der Security-Task sie bei jedem Lauf beruecksichtigt. Nutze diesen Skill, wenn der Nutzer die Sicherheits-Anforderungen des Projekts definieren oder anpassen will (z.B. "leg die Security-Vorgaben fest", "die App soll nur intern erreichbar sein", "wer darf zugreifen", "brauchen wir ein Backup", "adaptiere die Security-Policy").
---

# Sicherheits-Vorgaben des Projekts festlegen

Du hilfst dem Nutzer, die Sicherheits-Vorgaben fuer THIS project zu
definieren, und schreibst sie als bindende Vorgabe in
`delivery/security.md`. Diese Datei ist Kontext, den der Worker beim
Security-Task (Task-Typ "Security", req-014) liest: Sie ist das SOLL,
gegen das er das IST des Repos prueft. Ohne sie prueft der Worker nach
allgemeinen Best-Practices; mit ihr kann er konkret melden, wo die App
von der gewuenschten Sicherheitslage abweicht.

Halte es kurz — hoechstens eine Bildschirmseite. Die Datei ist eine
Vorgabe-Checkliste, kein Sicherheitskonzept.

Sprache: Fuehre den Dialog UND schreibe `delivery/security.md` in der
Sprache, in der der Nutzer mit dir spricht. Ausnahme (Maschinen-Vertrag):
Abschnitts-Ueberschriften, Ordnerpfade und der Dateiname
`delivery/security.md` bleiben unveraendert, egal in welcher Sprache.

## Flow

### 1. Intake

Lass den Nutzer die gewuenschte Sicherheitslage frei beschreiben.
Extrahiere, mit hoechstens 3-4 Entscheidungsfragen (jeweils mit
Optionen und einer kurz begruendeten Empfehlung):

- **Erreichbarkeit:** Ist die App nur intern im WLAN erreichbar oder auch
  von aussen (Internet)? Wenn von aussen: ist HTTPS Pflicht (Standard:
  ja)?
- **Zugriffskreis:** Nutzt nur der Betreiber selbst die App, oder auch
  andere Personen? Braucht es einen Login/Zugangsschutz?
- **Backup:** Werden Daten gehalten, die verloren gehen koennen? Wird ein
  Backup erwartet, und wenn ja, in welcher Frequenz und wo?
- **Datenschutz:** Werden personenbezogene oder sonst sensible Daten
  verarbeitet? Gibt es besondere Anforderungen (Verschluesselung,
  Loeschfristen)?

Zieh konkrete Vorgaben heraus, keine Allgemeinplaetze. Wo der Nutzer
keine Meinung hat, schlage die sichere Default-Variante vor und lass ihn
entscheiden.

### 2. Schreiben

Schreibe `delivery/security.md` im Template-Format unten. Existiert die
Datei schon, zeige dem Nutzer die Aenderungen, bevor du ueberschreibst
(dies ist ein Adaptions-Skill: der Nutzer passt die Vorgaben von Zeit zu
Zeit an).

### 3. Verlinken aus CLAUDE.md

`delivery/security.md` wird NICHT automatisch vom Worker geladen — sie
muss aus der CLAUDE.md referenziert sein, sonst ignoriert der Worker sie.
Stelle sicher, dass die CLAUDE.md des Repos einen Abschnitt `## Security`
mit einem Verweis enthaelt:

```markdown
## Security

Die Sicherheits-Vorgaben fuer dieses Projekt (Erreichbarkeit, HTTPS,
Zugriffskreis, Backup, Datenschutz) sind in
[delivery/security.md](delivery/security.md) definiert. Der Security-Task
(req-014) prueft dagegen.
```

Fehlt der Abschnitt, fuege ihn hinzu. Verweist er schon dorthin, lass ihn
stehen. Existiert keine CLAUDE.md, biete an, eine mit diesem Abschnitt
anzulegen.

### 4. Bestaetigen

Zeige dem Nutzer die geschriebene `delivery/security.md` vollstaendig und
bestaetige, dass der CLAUDE.md-Verweis steht. Committe oder pushe NICHT,
ausser der Nutzer bittet darum — dies ist eine Konventions-Aenderung, die
er zuerst pruefen sollte.

## Template

```markdown
---
project: <repo-name>
---

# Security-Vorgaben

Bindende Vorgabe fuer den Security-Task des autonomen Workers (req-014).
Er prueft bei jedem Lauf das IST des Repos gegen dieses SOLL.

## Erreichbarkeit

- Zugriff: <nur intern im WLAN | auch von aussen (Internet)>
- HTTPS: <Pflicht | nicht erforderlich>

## Zugriffskreis

- Nutzer: <nur der Betreiber | mehrere/andere Personen>
- Zugangsschutz: <Login erforderlich | offen im vertrauten Netz>

## Backup & Wiederherstellung

- Backup erwartet: <ja, Frequenz + Ort | nein>
- Wiederherstellung: <muss getestet sein | best effort>

## Datenschutz

- Sensible/personenbezogene Daten: <ja, welche | nein>
- Besondere Anforderungen: <Verschluesselung, Loeschfristen, ... | keine>
```

## Was du NIE tust

- Die Datei zu einem langen Sicherheitskonzept aufblaehen — sie ist eine
  kurze Vorgabe-Checkliste, kein Audit-Dokument.
- `delivery/security.md` unverlinkt aus der CLAUDE.md lassen — unverlinkt
  liest der Worker sie nie.
- Eine bestehende `delivery/security.md` ohne Diff ueberschreiben.
- Committen oder pushen, ohne dass der Nutzer darum bittet.
- Selbst einen Security-Check DURCHFUEHREN — dieser Skill legt nur die
  VORGABEN fest; die eigentliche Pruefung macht spaeter der Worker
  (req-014).
