---
name: setup-doc-site
description: Legt fuer THIS project die Grundvorgaben fuer die vom Worker gepflegte Doku-Website fest (Doku-Task, req-016) — den Ort der Design-Vorlage (HTML/CSS + Handover-Markdown) und die Deploy-Ziele fuer dev und prod (die andere Hosts sein koennen als die App selbst, z.B. dev auf Beelink, prod bei einem Webhoster). Schreibt delivery/doc-site.md und verlinkt sie aus CLAUDE.md, damit der Doku-Task sie bei jedem Lauf beruecksichtigt. Nutze diesen Skill, wenn der Nutzer festlegen oder aendern will, wie und wohin die Benutzer-Doku gebaut und deployt wird (z.B. "leg die Doku-Ziele fest", "wo liegt die Design-Vorlage", "die Doku soll auf Host X deployen").
---

# Doku-Website-Grundvorgaben festlegen

Du hilfst dem Nutzer, die Grundvorgaben fuer die vom Worker gepflegte
Benutzer-Dokumentation (Task-Typ "Doku", req-016) festzulegen, und
schreibst sie als bindende Vorgabe in `delivery/doc-site.md`. Diese Datei
ist Kontext, den der Worker beim Doku-Task liest: Sie sagt ihm, WO die
Design-Vorlage liegt und WOHIN die Doku deployt wird. Ohne Design-Vorlage
macht der Doku-Task nichts (req-016).

Halte es kurz — hoechstens eine Bildschirmseite. Die Datei ist eine
Vorgabe, kein Konzept-Dokument.

Sprache: Fuehre den Dialog UND schreibe `delivery/doc-site.md` in der
Sprache, in der der Nutzer mit dir spricht. Ausnahme (Maschinen-Vertrag):
Abschnitts-Ueberschriften, Ordnerpfade und der Dateiname
`delivery/doc-site.md` bleiben unveraendert, egal in welcher Sprache.

## Flow

### 1. Intake

Lass den Nutzer frei beschreiben, wie die Doku aussehen und wohin sie
deployen soll. Extrahiere, mit hoechstens 2-3 Entscheidungsfragen
(jeweils mit Optionen und kurz begruendeter Empfehlung):

- **Design-Vorlage:** Wo liegt die vom Nutzer erstellte Design-Vorlage
  (HTML/CSS-Vorlage + Handover-Markdown)? Vorschlag als Standard-Ort:
  `delivery/doc-design/`. Ohne diese Vorlage tut der Doku-Task nichts.
- **Deploy-Ziele:** Auf welchen Host deployt die Doku fuer dev, auf
  welchen fuer prod? Diese koennen sich von den App-Umgebungen
  unterscheiden (z.B. dev auf dem Beelink, prod bei einem Webhoster).
- **Verhaeltnis zum Human-Gate:** Bestaetige, dass prod-Deploy der Doku
  demselben Human-Gate unterliegt wie der Code (delivery/devops.md) —
  der Worker deployt Doku nie autonom nach prod.

Zieh konkrete Werte heraus (Hostnamen/URLs, Ordnerpfade), keine
Allgemeinplaetze.

### 2. Schreiben

Schreibe `delivery/doc-site.md` im Template-Format unten. Existiert die
Datei schon, zeige dem Nutzer die Aenderungen, bevor du ueberschreibst.

### 3. Verlinken aus CLAUDE.md

`delivery/doc-site.md` wird NICHT automatisch vom Worker geladen — sie
muss aus der CLAUDE.md referenziert sein, sonst ignoriert der Worker sie.
Stelle sicher, dass die CLAUDE.md des Repos einen Abschnitt `## Doku-Site`
mit einem Verweis enthaelt:

```markdown
## Doku-Site

Die Grundvorgaben fuer die vom Worker gepflegte Benutzer-Doku (Ort der
Design-Vorlage, Deploy-Ziele) sind in
[delivery/doc-site.md](delivery/doc-site.md) definiert. Der Doku-Task
(req-016) beruecksichtigt sie.
```

Fehlt der Abschnitt, fuege ihn hinzu. Verweist er schon dorthin, lass ihn
stehen. Existiert keine CLAUDE.md, biete an, eine mit diesem Abschnitt
anzulegen.

### 4. Bestaetigen

Zeige dem Nutzer die geschriebene `delivery/doc-site.md` vollstaendig und
bestaetige, dass der CLAUDE.md-Verweis steht. Committe oder pushe NICHT,
ausser der Nutzer bittet darum.

## Template

```markdown
---
project: <repo-name>
---

# Doku-Site-Vorgaben

Bindende Vorgabe fuer den Doku-Task des autonomen Workers (req-016).

## Design-Vorlage

- Ort: <Ordnerpfad, z.B. delivery/doc-design/>
- Bestandteile: HTML/CSS-Vorlage + Handover-Markdown
- Bindung: Orientierung — der Worker haelt sich so weit wie moeglich an
  die Vorlage, hat aber Freiheiten. Ohne Vorlage tut der Doku-Task nichts.

## Ausgabe im Repo

- Doku-Ordner: site/user-docs/ (unter dem gemeinsamen Web-Root site/;
  daneben entstehen spaeter site/tech-docs/ und site/www/)

## Deploy-Ziele

| Umgebung | Host/URL              | Ausloeser              |
|----------|-----------------------|------------------------|
| dev      | <z.B. Beelink / URL>  | Push auf dev           |
| prod     | <z.B. Webhoster / URL>| nur ueber Human-Gate   |

Prod-Deploy der Doku unterliegt demselben Human-Gate wie der Code
(delivery/devops.md): nie autonom nach prod.
```

## Was du NIE tust

- Die Datei zu einem langen Konzept aufblaehen — sie ist eine kurze
  Vorgabe.
- `delivery/doc-site.md` unverlinkt aus der CLAUDE.md lassen — unverlinkt
  liest der Worker sie nie.
- Eine bestehende `delivery/doc-site.md` ohne Diff ueberschreiben.
- Committen oder pushen, ohne dass der Nutzer darum bittet.
- Die Design-Vorlage SELBST erstellen — die macht der Nutzer mit Claude
  Design; dieser Skill haelt nur fest, WO sie liegt und WOHIN deployt
  wird.
- Ein autonomes prod-Deploy der Doku vorsehen — das bleibt beim
  Human-Gate.
