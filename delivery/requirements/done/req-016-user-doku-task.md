---
id: req-016
title: User-Dokumentation-Task — Worker pflegt eine mehrseitige Doku-Website (max. 1×/Tag)
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
---

# Goal (Why)

Ich will, dass der Worker die Benutzer-Dokumentation der App als moderne,
mehrseitige Website pflegt und aktuell hält — damit meine Nutzer immer
eine ansprechende, verständliche Doku haben, ohne dass ich sie von Hand
schreibe.

# Function (What)

Ein neuer wiederkehrender Task-Typ "Doku" — analog zu Code-Review
(req-006), Ideen (req-011) und Security (req-014): kein ready-.md nötig,
höchstens einmal pro Repo und Kalendertag (aus dem run_log abgeleitet),
nur in den P3–P5-Zeitfenstern.

Pro Lauf:
1. Der Worker liest die Design-Vorgabe des Repos (HTML/CSS-Vorlage plus
   Handover-Markdown, Ort steht in `delivery/doc-site.md`). Fehlt die
   Design-Vorgabe, tut der Worker NICHTS und vermerkt im Verlauf "keine
   Design-Vorgabe hinterlegt". Ohne Vorgabe passiert nichts.
2. Aus den umgesetzten Requirements (`delivery/requirements/done/`) und
   dem Code leitet er den Doku-Inhalt ab und erzeugt bzw. aktualisiert
   eine mehrseitige Benutzer-Doku als HTML-Seiten. Er hält sich SO WEIT
   WIE MÖGLICH an die Design-Vorlage (Orientierung, kein starres
   Template ohne Freiheiten).
3. Die Aktualisierung ist INKREMENTELL: der Worker fügt neue Inhalte
   hinzu und passt bestehende Seiten bei Änderungen an; er baut die Doku
   NICHT bei jedem Lauf komplett neu. Die Seite soll nicht bei jedem Lauf
   anders aussehen.
4. Alles, was zur Doku gehört (HTML, CSS, Assets), legt er in den Ordner
   `site/user-docs/` im Repo (unter dem gemeinsamen Web-Ausgabe-Root
   `site/`), committet und pusht auf `dev`. Der Push löst den
   dev-Deploy aus; nach prod wird sie nur über das Human-Gate promotet
   (wie beim Code, siehe delivery/devops.md). Die konkreten Doku-Hosts
   für dev/prod stehen in `delivery/doc-site.md`.

# Acceptance Criteria

- [ ] Given `delivery/doc-site.md` verweist auf eine vorhandene
  Design-Vorlage und der Doku-Task ist fällig und lief heute für
  "appbaua" noch nicht, when der Worker ihn ausführt, then entsteht bzw.
  aktualisiert sich unter `site/user-docs/` eine mehrseitige HTML-Doku,
  die auf `dev` gepusht wird.
- [ ] Given es ist KEINE Design-Vorgabe hinterlegt, when der Doku-Task
  läuft, then wird KEINE Doku erzeugt und im Verlauf steht "keine
  Design-Vorgabe hinterlegt".
- [ ] Given der Doku-Task lief heute für "appbaua" bereits, when der
  Worker im selben Kalendertag erneut an "appbaua × Doku" kommt, then
  wird der Schritt übersprungen.
- [ ] Given es existiert bereits eine Doku unter `site/user-docs/` und
  ein neues Requirement wurde umgesetzt, when der Doku-Task läuft, then
  wird der neue Inhalt ergänzt bzw. die betroffene Seite angepasst, und
  unveränderte Seiten bleiben inhaltlich bestehen (die Doku wird nicht
  komplett neu aufgebaut).
- [ ] Given eine Design-Vorlage mit einer bestimmten Kopf-/Farbgestaltung
  ist hinterlegt, when der Worker die Doku erzeugt, then folgt die
  erzeugte Doku erkennbar dieser Gestaltung.

# Constraints

- Die Design-Vorgabe (HTML/CSS-Vorlage + Handover-Markdown) wird vom
  Nutzer erstellt und hochgeladen; ihr Ort und die Doku-Deploy-Ziele
  (dev/prod-Hosts) stehen in `delivery/doc-site.md`. Ohne diese Datei und
  ohne Design-Vorlage macht der Doku-Task nichts.
- Prod-Deploy der Doku unterliegt demselben Human-Gate wie der Code
  (delivery/devops.md): der Worker deployt Doku nie autonom nach prod.

# Out of Scope

- Screenshots/Videos der App per Playwright auf der Doku-Website — Phase 2
  (separates Requirement req-017).
- Technische Dokumentation und die öffentliche Website — kommen später
  als eigene Inhalte unter `site/` (z.B. `site/tech-docs/`, `site/www/`),
  nicht Teil dieses Requirements.
- Der Setup-Skill, mit dem `delivery/doc-site.md` und die Design-Vorgabe
  eingerichtet werden — wird getrennt eingerichtet.
- Das Erstellen der Design-Vorlage selbst (macht der Nutzer mit Claude
  Design).
- Aktives Deployen durch den Worker per SSH/FTP — der Deploy läuft über
  den Push wie beim Code, nicht durch den Worker selbst.
