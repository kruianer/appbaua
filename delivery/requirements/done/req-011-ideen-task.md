---
id: req-011
title: Ideen-Task — Worker schlägt neue Ideen vor (1×/Tag, ohne Dubletten)
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-25
changes: req-006
---

# Goal (Why)

Ich will, dass der Worker mir pro Repo regelmäßig neue Ideen für die App
vorschlägt — ohne dieselbe Idee doppelt zu bringen und ohne bereits
Umgesetztes erneut vorzuschlagen — damit ich einen stetigen Strom
sinnvoller Vorschläge bekomme, aus denen ich Requirements machen kann.

# Function (What)

Der bereits vorhandene Task-Typ "Ideen" (req-002) wird als funktionierender
wiederkehrender Typ umgesetzt — analog zu Code-Review (req-006): kein
ready-.md nötig, höchstens einmal pro Repo und Kalendertag (aus dem
run_log abgeleitet).

Pro Lauf:
1. Der Worker liest die vorhandenen Ideen des Repos in `delivery/idea/`
   (offene) und `delivery/idea/done/` (umgesetzte) sowie — falls
   vorhanden — die Richtungs-Vorgabe `delivery/idea-direction.md`.
2. Claude Code schlägt GENAU EINE neue Idee vor, die inhaltlich weder
   eine Dublette einer bestehenden/umgesetzten Idee ist, noch bereits
   umgesetzt wurde, und die (falls vorhanden) zur Richtungs-Vorgabe passt.
   Existiert keine Richtungs-Vorgabe, schlägt er frei eine sinnvolle Idee
   zum Repo vor.
3. Die Idee wird als eigene .md-Datei in `delivery/idea/` abgelegt (mit
   Frontmatter Titel + Datum und den Abschnitten "Problem/Nutzen" und
   "Skizze"), committet und auf `dev` gepusht.

Findet der Worker keine neue, nicht-dublette Idee, legt er keine Datei an,
schreibt einen Log-Eintrag "keine neue Idee gefunden", und der Tag zählt
als erledigt (kein erneuter Ideen-Lauf am selben Tag für dieses Repo).

Umgesetzte Ideen verschiebe ich (der Mensch) nach `delivery/idea/done/`;
der Worker liest diesen Ordner mit, um Umgesetztes nicht erneut
vorzuschlagen.

# Acceptance Criteria

- [ ] Given der Task-Typ "Ideen" ist aktiv und fällig und lief heute für
  Repo "appbaua" noch nicht, when der Worker ihn ausführt, then entsteht
  in `delivery/idea/` eine neue Idee-Datei, die auf `dev` gepusht wird.
- [ ] Given der Ideen-Task lief heute für "appbaua" bereits, when der
  Worker im selben Kalendertag erneut an "appbaua × Ideen" kommt, then
  wird der Schritt übersprungen (keine zweite Idee am selben Tag).
- [ ] Given in `delivery/idea/` liegt bereits eine Idee "CSV-Export", when
  der Worker eine neue Idee vorschlägt, then ist die neue Idee inhaltlich
  eine ANDERE (keine erneute "CSV-Export"-Idee).
- [ ] Given eine Idee wurde nach `delivery/idea/done/` verschoben, when
  der Worker eine neue Idee vorschlägt, then schlägt er diese umgesetzte
  Idee NICHT erneut vor.
- [ ] Given es existiert `delivery/idea-direction.md` mit einer Richtung,
  when der Worker eine Idee vorschlägt, then passt die Idee erkennbar zu
  dieser Richtung.
- [ ] Given der Worker findet keine neue, nicht-dublette Idee, when der
  Lauf endet, then wird KEINE Idee-Datei angelegt und im Verlauf steht
  "keine neue Idee gefunden".
- [ ] Given eine Idee-Datei wurde angelegt, when ich sie öffne, then hat
  sie Frontmatter (Titel, Datum) und die Abschnitte "Problem/Nutzen" und
  "Skizze".

# Constraints

- Der Task-Typ "Ideen" muss im Worker als wiederkehrender Typ mit dem
  Ordner `delivery/idea` registriert sein. (Der Code-Review 2026-07-25
  fand, dass `ideen` in der Task-Typ-Quellenzuordnung fehlt und der
  zugehörige Prompt fehlerhaft formuliert ist — dies ist mit umzusetzen.)
- Die Richtungs-Vorgabe pro Repo lebt in `delivery/idea-direction.md` und
  wird in der CLAUDE.md des jeweiligen Repos referenziert (analog zu
  delivery/stack.md). Der Nutzer pflegt sie separat.

# Out of Scope

- Der Skill, mit dem der Nutzer `delivery/idea-direction.md` erstellt/
  pflegt — wird getrennt eingerichtet, ist nicht Teil dieses Requirements.
- Automatisches Überführen einer Idee in ein Requirement/Bug.
- Ein UI zum Durchblättern der Ideen in der App (nur Dateien im Repo).
- Mehr als eine Idee pro Lauf.
