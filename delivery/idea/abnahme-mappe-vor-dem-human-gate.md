---
titel: "Abnahme-Mappe — was gerade vor dem Human-Gate steht"
datum: 2026-09-17
---

## Problem/Nutzen

Die Promotion nach prod ist der eine Akt, den dieses System bewusst dem
Menschen vorbehält: Vision ("Nie autonom nach prod deployen oder auf main
mergen — das bleibt das Gate des Menschen") und `delivery/devops.md`
("NUR der Nutzer merged diesen PR") sagen dasselbe, und die Ideen-Richtung
erklärt das Gate ausdrücklich für tabu. Nur: **Für genau diesen einen Akt
bietet appbaua heute keinerlei Unterstützung.** Die App zeigt, was der
Worker tut (req-005/req-008), was er getan hat (req-004) und wie es den
überwachten Apps geht (req-032) — sie zeigt an keiner Stelle, was dadurch
inzwischen auf `dev` liegt und auf die Freigabe wartet.

Das Quality Gate in `devops.md` verlangt vom Betreiber zwei Dinge: Er
nimmt Änderungen auf der dev-URL ab, und "eine Änderung, die auf der
dev-URL nicht manuell überprüfbar ist, ist nicht fertig". Um diese Zusage
einzulösen, muss er heute vier Quellen im Kopf zusammenführen, von denen
keine in der App liegt: `git log main..dev` für den tatsächlichen Stand,
`delivery/requirements/done/` und `delivery/bugs/done/` für die Frage,
welche Pakete darin überhaupt stecken, die einzelnen .md-Dateien für die
Akzeptanzkriterien, an denen er prüfen könnte, und den Verlauf für die
Frage, wann und wie das entstanden ist. Der Worker hat all das beim
Arbeiten in der Hand — beim Abnehmen hat der Mensch nichts davon.

Daraus entstehen zwei Fehlerfälle, die von außen identisch aussehen —
ein grünes dev und ein `main`, das hinterherhinkt:

- **Er merged zu viel.** Im Stapel steckt ein Paket, von dem er nichts
  wusste und das er nie auf dev geöffnet hat. Das Gate wurde formal
  durchlaufen, inhaltlich aber nicht — die teuerste Art, ein Gate zu
  haben.
- **Er merged gar nicht.** Weil unklar ist, was drin ist, schiebt er die
  Promotion auf. Der Abstand dev↔prod wächst still weiter, und mit jedem
  Tag wird die nächste Freigabe größer, unübersichtlicher und riskanter —
  bis niemand mehr guten Gewissens "ja" sagen kann.

Das ist dasselbe Muster, das dieses Repo bereits als teuersten Fehlerfall
benannt hat (siehe
[Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md),
[Backup-Drill](backup-mit-restore-drill-nachweis.md),
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md)): ein
Zustand, der wie der gute Normalfall aussieht. Nur sitzt er hier nicht im
Worker, sondern an der Schnittstelle zum Menschen.

Wichtig zur Abgrenzung: Diese Idee **weicht das Gate nicht auf, sie
bewaffnet es**. Es wird nichts automatisch gemerged, nichts automatisch
als abgenommen gewertet und nichts nach prod geschoben. Die Entscheidung
bleibt exakt dort, wo sie ist — sie bekommt nur endlich ein
Inhaltsverzeichnis.

Nutzen:

- **Rock-solid Qualität** — nichts kommt nach prod, weil niemand wusste,
  dass es im Stapel lag.
- **Nachvollziehbarkeit** — "was steht zur Abnahme an" ist eine Seite
  statt vier Quellen und ein guter Gedächtnisstand.
- **Ansprechende Visualisierung** — der Abstand dev↔prod wird als Bild
  sichtbar: Pakete auf dem Weg zum Gate, mit Alter und Abnahmestand,
  statt als Zahl in einem `git log`.
- **Stärkung des Human-Gates** — der Mensch entscheidet mit demselben
  Wissen, mit dem der Worker gearbeitet hat.

## Skizze

**Neue Seite "Abnahme", je Repo.** Sie beantwortet eine Frage: Was liegt
auf `dev` und noch nicht auf `main`?

**Pakete statt Commits.** Der Delta `main..dev` wird nicht als
Commit-Liste gezeigt, sondern nach Requirement- bzw. Bug-Kennung
gruppiert (die Branch-/Commit-Konvention aus req-020 liefert die
Zuordnung). Ein Paket zeigt: Kennung und Titel, Task-Typ, wann fertig
gemeldet, Link auf die .md und auf die betroffenen Dateien.

**Die Kriterien werden zur UAT-Checkliste.** Je Paket zieht die Seite die
Akzeptanzkriterien aus der .md — appbaua liest sie bereits
(`lib/acceptance-criteria.ts`, req-036). Jedes Kriterium wird zu einem
Häkchen, das **der Betreiber** setzt, nachdem er es auf
`https://dev.appbaua.com` tatsächlich gesehen hat. Entscheidend: Diese
Häkchen leben in der App-Datenbank und werden **nicht** in die .md
zurückgeschrieben — dort sind die Kästchen das Etappen-Gedächtnis des
Workers (req-036); beides zu vermischen würde genau diesen Mechanismus
beschädigen.

**Der Kopf der Seite als Ampel des Stapels.** "4 Pakete · 17 Kriterien ·
11 abgenommen · ältestes seit 9 Tagen auf dev". Das Alter ist der
eigentliche Frühwarnwert: ein Stapel, der altert, ist ein Gate, das
klemmt.

**Das Bild.** Eine waagerechte Strecke `dev → Gate → prod`. Jedes Paket
eine Karte darauf: grau = noch nicht geprüft, grün = abgenommen,
gelb = teilweise. Das Gate steht als sichtbare Schranke dazwischen, die
nur der Mensch öffnet. Darunter, wenn der
[Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md) einmal existiert,
je Paket sein maschineller Nachweis neben den Handprüfungen — grün
belegt und grün gesehen nebeneinander.

**Eine einzige Aktion: "PR nach main öffnen".** Mehr darf die Seite
nicht, und mehr soll sie nicht. Sind noch Kriterien offen, weist sie
darauf hin — als Hinweis, nicht als Sperre; der Mensch entscheidet, auch
gegen die Liste. Einen Merge-Knopf gibt es nicht. Die Ausnahme aus
`devops.md` (Promotion auf ausdrücklichen Wunsch in einer Sitzung) bleibt
außerhalb dieser Seite, wo sie hingehört: im Gespräch.

**Bewusst nicht dabei:** kein automatisches Abnehmen, kein vom Worker
abgeleiteter Status "geprüft", keine Bewertung der Qualität eines Pakets,
kein prod-Deploy.

**Offene Weiche (zu entscheiden, nicht vorauszusetzen):** Woher kommt die
Zuordnung Commit → Paket? Entweder aus `git log main..dev` gelesen —
billig, aber anfällig gegen Rebase und Squash (bug-017 zeigt, dass
Rebases hier Alltag sind) — oder der Worker vermerkt die Kennung beim
Abschluss selbst in der Datenbank, mit `git log` als Rückfallebene. Die
zweite Variante ist robuster, kostet aber einen Eingriff in den
Worker-Ablauf; das gehört vor der Umsetzung entschieden.
