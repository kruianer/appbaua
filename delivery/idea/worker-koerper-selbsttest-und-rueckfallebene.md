---
titel: "Selbsttest und Rückfallebene — der Worker darf sich nicht selbst aussperren"
datum: 2026-09-24
---

## Problem/Nutzen

appbaua ist das einzige Repo in seiner eigenen Liste, das der Worker
bearbeitet **und in dem er wohnt**. Beides hängt über genau einen Schritt
zusammen: Der Worker committet auf `dev` (devops.md, Hard Rules), der
Push löst `deploy.yml` aus, und dieser Workflow führt
`docker compose up -d --build` aus — was den `worker`-Dienst aus
`docker-compose.yml` mitbaut und neu startet. Der Worker zieht sich also
mit jedem eigenen Arbeitsergebnis selbst den Boden unter den Füßen weg.

Solange das gutgeht, ist es elegant. Der Fehlerfall ist es nicht, und er
ist in diesem Repo bereits **viermal** eingetreten:

- `bug-006` — playwright-core fehlt im Worker-Container
- `bug-010` — vitest fehlt im Worker-Container
- `bug-016` — Worker-Container ohne bash
- `bug-018` — Worker-Container sammelt Zombie-Prozesse

Alle vier haben eines gemeinsam, und das ist der eigentliche Befund:
**Sie sind durch das Quality Gate gelaufen.** Der `test`-Job in
`deploy.yml` fährt `npm ci`, `lint`, `typecheck`, `test` — auf dem
Runner, gegen den Quelltext. Er baut `Dockerfile.worker` nicht und
startet ihn nie. Ein fehlendes Werkzeug im Image, ein kaputter
Entrypoint, eine weggefallene Shell: grün in CI, tot im Betrieb. Das
Gate prüft, was der Worker denkt — nicht, womit er arbeitet.

Dazu kommt die Selbstversiegelung. Der `worker`-Dienst hat
`restart: unless-stopped` und **keinen Healthcheck**. Ein Container, der
beim Start sofort stirbt, wird endlos neu gestartet, ohne dass irgendwo
ein Zustand entsteht, den jemand sehen könnte. Und die einzige Instanz,
die einen Fehler in appbaua beheben könnte, ist genau die, die gerade
kaputt ist — sie kann sich nicht aus einem Loch herausarbeiten, in dem
sie selbst liegt. Ein Bug in einem fremden Repo kostet einen Lauf; ein
Bug im eigenen Körper kostet **alle** Läufe, für alle Repos, bis ein
Mensch per SSH eingreift. Das ist der einzige Single Point of Failure
dieses Systems, der sich nicht selbst melden kann.

Nutzen:

- **Rock-solid Qualität** — die Klasse von Fehlern, die dieses Repo
  nachweislich am häufigsten getroffen hat (4 von 22 Bugs), bekommt zum
  ersten Mal ein Gate. Für einen Worker, der öffentlich einsetzbar sein
  soll, ist "er kann sich selbst lahmlegen und niemand merkt es" die
  härteste offene Flanke.
- **Nachvollziehbarkeit** — "der Worker läuft" wird vom Wunsch zum
  Nachweis: sichtbar ist, welche Werkzeuge sein aktuelles Image
  tatsächlich hat und seit welchem Deploy.
- **Ansprechende Visualisierung** — eine Deploy-Leiste des eigenen Repos,
  grün/rot je Selbsttest, macht den Zusammenhang "dieser Commit hat
  meinen Körper verändert" auf einen Blick lesbar.

Abgrenzung zu bestehenden Ideen: Der
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md) **erkennt**,
dass der Worker nicht mehr lebt, und grenzt ihn ausdrücklich gegen
automatische Neustart-Logik ab. Diese Idee setzt eine Ebene davor an: sie
verhindert, dass er es überhaupt wird, und gibt ihm einen Weg zurück.
Der [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md) belegt
Quality Gates **für einen Arbeitsschritt**; hier geht es um das Gate für
die Laufzeitumgebung, die diese Schritte überhaupt erst ausführt — die
Stelle, die der Schritt-Beleg voraussetzt und nicht abdeckt.

## Skizze

**Kern:** Der Worker beschreibt die Werkzeuge, die er zum Arbeiten
braucht, an einer Stelle — und beweist beim Start, dass er sie hat.

**1. Eine Liste statt verstreuter Annahmen.** Heute steht implizit in
`Dockerfile.worker` und verteilt im Code, was der Worker zum Arbeiten
benötigt. Stattdessen eine deklarative Liste im Repo — git, node, eine
Shell, das Claude-CLI, vitest, playwright, ein PID-1-Init, Schreibrecht
auf `/work`, DB erreichbar. Jeder Eintrag ist ein Name plus eine
Prüfung, die in Sekunden läuft.

**2. Der Selbsttest beim Start.** Der Worker geht diese Liste einmal beim
Hochfahren durch, bevor er den ersten Schritt auswählt, und schreibt das
Ergebnis in die DB — mit dem Commit, aus dem sein Image gebaut wurde.
Kein neuer Task-Typ, keine neue Entscheidung: ein Selbstcheck an genau
der Stelle, an der der Prozess ohnehin startet.

**3. Ein sichtbarer Zustand statt stiller Crash-Loop.** Auf der
Status-/Zustandsseite:

```
● Worker-Körper   9/9 Werkzeuge vorhanden   · Image aus 45c288b, 02:14 Uhr

✗ Worker-Körper   8/9 — vitest fehlt
  seit Deploy a152978 (2026-09-24, 03:02 Uhr) · Test-Gate nicht ausführbar
```

Die zweite Zeile ist genau das, was bug-010 gekostet hat: ein Zustand,
den heute niemand sieht, weil der Worker fröhlich weiterläuft und nur
sein Test-Gate stillschweigend nicht mehr greift.

**4. Die Rückfallebene.** Ein Image, dessen Selbsttest bestanden hat,
wird als „zuletzt tauglich" markiert. Scheitert der Selbsttest nach einem
Deploy, läuft der Worker auf dieser markierten Version weiter — und
meldet unübersehbar, dass er das tut und warum. Der Repo-Stand bleibt
dabei unangetastet auf dem neuen Commit. Das ist der entscheidende Punkt:
Der Worker behält damit einen arbeitsfähigen Körper, mit dem er den
Fehler, den er sich selbst eingebaut hat, im nächsten Lauf **selbst
beheben** kann — statt darauf zu warten, dass ein Mensch per SSH kommt.

**5. Die Deploy-Leiste (Visualisierung).** Im eigenen Repo-Eintrag eine
waagerechte Leiste der letzten Deploys, ein Segment je Commit, grün bei
bestandenem Selbsttest, rot bei gescheitertem, mit Kurzhinweis beim
Darüberfahren. Ein roter Klotz zeigt sofort, welcher eigene Commit den
Körper beschädigt hat — die Frage, die bei bug-006, bug-010 und bug-016
jedes Mal von Hand rekonstruiert werden musste.

**Ehrlichkeits-Regel.** Ein gescheiterter Selbsttest wird nie zu
„läuft" geglättet — auch nicht nach einem Neustart der App, und auch
nicht, wenn der Worker auf der Rückfallebene wieder munter arbeitet. Er
bleibt sichtbar, bis ein Deploy den Test wieder besteht. Sonst
reproduziert diese Idee genau das Muster, das sie beheben soll: ein
Zustand, der wie der gute Normalfall aussieht.

**Abgrenzung / bewusst NICHT Teil davon:**

- **Kein Anfassen des Human-Gates.** Alles hier betrifft ausschließlich
  den Weg, den der Worker ohnehin gehen darf (`dev`). Kein Merge nach
  `main`, kein prod-Deploy, keine Änderung an der Promotion.
- **Kein automatischer Code-Rollback.** Es fällt höchstens die
  *Laufzeitumgebung* auf eine ältere, belegt taugliche Version zurück —
  niemals werden Commits revertet, Branches zurückgesetzt oder Arbeit
  verworfen. Der Repo-Stand bleibt immer der neue.
- **Kein Selbst-Neustart-Automatismus.** Diese Idee erzeugt einen
  Nachweis und eine Rückfallebene, keine Heilungslogik, die im
  Hintergrund an Containern herumschaltet.
- **Wo genau die Rückfallebene greift** — im Deploy-Workflow, über einen
  Compose-Healthcheck oder über ein festgehaltenes Image-Tag — ist eine
  Infrastruktur-Weiche und wird hier ausdrücklich nur **vorgeschlagen**,
  nicht vorausgesetzt. Vor Umsetzung mit dem Nutzer zu klären, ebenso wie
  der genaue Umfang der Werkzeug-Liste.
