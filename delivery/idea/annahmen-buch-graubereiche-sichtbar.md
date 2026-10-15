---
titel: "Annahmen-Buch — die Graubereich-Entscheidungen des Workers haben keinen Ort"
datum: 2026-10-15
---

## Problem/Nutzen

Die Vision stellt dem Worker genau eine Bedingung für das autonome
Arbeiten: „Im Zweifel: beste Annahme treffen **UND sichtbar
dokumentieren**, statt zu blockieren — der Mensch ist nachts nicht
erreichbar." Die erste Hälfte dieses Satzes ist eingebaut, die zweite
nicht. Der Worker trifft jede Nacht Annahmen; **sichtbar** werden sie
nirgends.

Der Befund ist nachprüfbar und eng umrissen:

- Der Arbeitsauftrag verlangt sie nicht. `fileTaskPrompt`
  (`lib/claude-runner.ts`) sagt dem Worker, was er bauen, wie er in
  Etappen schneiden, wann er committen und dass er nicht pushen soll — er
  endet mit „Arbeite vollständig autonom; frage nichts." Kein Wort davon,
  die Zweifelsfälle festzuhalten. Dasselbe gilt für `testFixPrompt`.
- Der Verlauf hat keinen Platz dafür. `RunLogEntry` (`lib/run-log.ts`)
  kennt `message`, `md`, `errorKind` und — seit req-037 — `diagnostics`.
  Für Fehler ist also längst ein eigenes Feld da; für Entscheidungen
  keines.
- Die App zeigt es nicht, weil es nichts zu zeigen gibt. `grep -i
  annahme` über `lib/`, `app/`, `components/`, `worker/` und `agent/`
  findet zwei Prosa-Kommentare in `lib/workspace.ts` — und keinen
  Mechanismus.

Was fehlt, ist damit nicht ein hübscheres Log, sondern die Gegenleistung
für das Zugeständnis „frag nicht". Der Betreiber hat dem Worker erlaubt,
Lücken selbst zu schließen. Er bekommt dafür einen Satz Code und eine
Verlaufszeile „req-0xx abgearbeitet" — aber nicht die Stelle, an der die
Datei offen war und der Worker sich entschieden hat.

**bug-008 ist dieser Fall, ausgeschrieben.** Die Vision beschreibt die
Abarbeitungs-Reihenfolge („Repo 1 vor Repo 2 vor Repo 3"); ob dabei das
Repo oder der Task-Typ die äußere Schleife ist, stand nicht da. Der
Worker entschied — Task-Typ außen — und hielt die Entscheidung sogar
fest: als Kommentar in `lib/scheduling.ts`, laut Bug-Bericht
ausdrücklich („task-type priority is the OUTER loop"). Die Annahme war
also dokumentiert, nur an dem einen Ort, an dem der Betreiber nicht nach
Entscheidungen sucht: mitten im Quelltext der Funktion, die sie umsetzt.
Sichtbar wurde sie erst, als jemand das falsche Verhalten im Betrieb
bemerkte und einen Bug schrieb. Eine Zeile „Reihenfolge offen gelassen —
ich nehme Task-Typ außen" am Schritt hätte dieselbe Frage am Morgen
danach auf den Tisch gelegt, statt nach Wochen über ein Fehlverhalten.

Und hier liegt der eigentliche Kostenpunkt: Eine Annahme ist am Tag ihrer
Entstehung **billig** zu korrigieren — die .md ist frisch, der Code klein,
nichts hängt dran. Je länger sie unbemerkt trägt, desto mehr baut das
System auf ihr auf. Das ist wieder das Muster, das dieses Repo mehrfach
als seinen teuersten Fehlerfall benannt hat (siehe
[Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md),
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md)): ein Zustand,
der wie der gute Normalfall aussieht. Ein Paket, bei dem der Worker drei
Lücken nach eigenem Ermessen gefüllt hat, ist im Verlauf nicht von einem
zu unterscheiden, dessen Requirement wasserdicht war — beide stehen als
grüner Haken da.

Für die Abnahme ist das die unangenehmste Variante. Der Betreiber prüft
am Human-Gate gegen das, was er erwartet hat; eine Annahme ist aber per
Definition das, was er **nicht** gesagt hat und folglich auch nicht
prüft. Genau die Abweichungen, die eine Abnahme finden müsste, sind die,
die sie nicht sucht.

Nutzen:

- **Nachvollziehbarkeit** — die Vision-Zusage „sichtbar dokumentieren"
  bekommt zum ersten Mal einen Ort. Nicht „was hat der Worker gebaut",
  sondern „wo musste er selbst entscheiden, und wie".
- **Rock-solid Qualität** — Fehlannahmen werden am Tag danach gefunden,
  solange sie einen Satz kosten, statt nach Wochen als Bug mit Nachbau.
- **Entscheidungsgrundlage am Human-Gate** — der Betreiber prüft gezielt
  die Stellen, an denen sein Requirement offen war, statt überall gleich
  genau hinzusehen.
- **Bessere Requirements** — häufen sich Annahmen immer an derselben
  Stelle (Zeitfenster, Reihenfolgen, Fehlerfälle), ist das eine
  Rückmeldung an die Erfassungs-Skills, keine Eigenschaft des Workers.
- **Ansprechende Visualisierung** — die offenen Fragen eines Pakets
  werden ein Bild, keine Fußnote.

## Skizze

**Kern:** Jeder Schritt liefert neben seinem Ergebnis null bis wenige
**Annahmen**. Eine Annahme ist ein kurzer, strukturierter Eintrag mit
vier Feldern: *was war offen* — *wie habe ich entschieden* — *warum* —
*woran hängt es* (Datei/Zeile, Commit, betroffenes Kriterium). Sie
entsteht dort, wo sie entsteht: im Lauf selbst, als geforderte Ausgabe
des Prompts, und wird am Schritt gespeichert statt im Quelltext
abgelegt.

**Die Prompts bekommen einen Satz dazu.** `fileTaskPrompt` und
`testFixPrompt` verlangen am Ende, die Zweifelsfälle aufzuführen — mit
einer klaren Latte, damit nicht jede Namenswahl zur Annahme wird:
festzuhalten ist, was ein anderer vernünftiger Leser derselben .md
**anders hätte entscheiden können**. Keine offene Frage im Paket? Dann
ist die Antwort leer, und das ist der gute Fall.

**Darstellung 1 — Annahmen am Verlaufseintrag.** Aufklappbar, wie der
Fehler-Block aus req-037, kompakt fürs Smartphone:

```
✓ Requirements × appbaua — req-0xx-…md              #a3876c5
  ? Reihenfolge Repo/Task-Typ in der .md nicht festgelegt
    → Repo außen, Task-Typ innen         Vision „Repo 1 vor Repo 2"
    lib/scheduling.ts · Kriterium 2      [bestätigen] [so nicht]
```

**Darstellung 2 — Annahmen je Paket.** Ein Paket (Requirement/Bug) sammelt
die Annahmen aller seiner Etappen. Liegt die
[Abnahme-Mappe](abnahme-mappe-vor-dem-human-gate.md) einmal vor, gehören
sie dort neben die UAT-Häkchen: die Kriterien sind, was der Betreiber
verlangt hat, die Annahmen sind, was er nicht gesagt hat — beides vor
derselben Freigabe.

**Darstellung 3 — Fragezeichen-Karte.** Die Dichte über Repos und Zeit
als Raster: Zeilen = Repos, Spalten = Tage, Helligkeit = Zahl der
Annahmen. Daraus ist auf einen Blick ablesbar, was sonst niemand
zusammenträgt: ob ein Repo systematisch unterspezifiziert hereinkommt,
und ob eine Nacht ungewöhnlich viele offene Fragen hatte — ein guter
Grund, dort zuerst abzunehmen.

**Zwei Zustände, nicht mehr.** Eine Annahme ist *unbestätigt* oder
*gesehen* — letzteres setzt nur der Mensch, per Knopf. „So nicht" schreibt
keinen Code um, sondern legt den Entwurf eines Bug- bzw.
Requirement-Pakets an, das der Betreiber abschickt oder verwirft; die
Annahme bleibt als Vorgeschichte daran hängen. Bewusst kein Workflow mit
fünf Stufen — die [Ideen-Halde](ideen-halde-entscheidung-statt-ablage.md)
zeigt, dass eine Ablage ohne Weg zur Entscheidung verlandet, aber ein
schwerer Weg wird auch nicht gegangen.

**Ehrlichkeits-Regeln (sonst trägt die Idee nicht):**

- Eine Annahme ist eine **Selbstauskunft** der KI — anders als ein
  Exit-Code aus dem [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md)
  ist sie nicht maschinell nachweisbar. Das lässt sich nicht wegbauen,
  nur eingrenzen: Jeder Eintrag muss auf ein überprüfbares Artefakt
  zeigen (Datei, Commit, Kriterium). Was auf nichts zeigt, ist eine
  Meinung und wird als solche markiert, nicht als Beleg geführt.
- „Keine Annahmen" ist ein **eigener, sichtbarer** Zustand und wird nie
  als „alles sauber" geglättet. Er heißt nur: der Lauf hat keine
  gemeldet.
- Eine alte unbestätigte Annahme verblasst nicht. Sie altert sichtbar,
  wie der Stapel in der Abnahme-Mappe — das Alter ist der Frühwarnwert.
- Nichts daran blockiert den Worker. Er entscheidet weiter selbst und
  läuft weiter durch; er legt die Entscheidung nur offen.

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene über Material, das heute
im Lauf entsteht und verworfen wird. Kein Rückfragen-Kanal, keine
Warteschlange, auf die der Worker nachts wartet — das wäre das Gegenteil
der Vision. Kein Eingriff in das prod/main-Gate: der Mensch bekommt mehr
in die Hand, entscheidet aber genauso viel wie vorher. Keine Änderung an
der Auswahl-Logik, keine neue Testinfrastruktur, keine Rückschreibung in
die .md (die Kästchen dort bleiben das Etappen-Gedächtnis aus req-036).

**Offene Weiche (zu entscheiden, nicht vorauszusetzen):** Wie kommen die
Annahmen aus dem Lauf heraus? Entweder als vereinbarter Abschnitt in der
finalen Antwort, die der Worker ohnehin schon einliest und parst —
billig, aber formatabhängig — oder als eigene Datei, die der Lauf im
Arbeitsverzeichnis ablegt und der Worker einsammelt, robuster gegen
Formulierungs-Schwankungen, aber ein zusätzlicher Vertrag mit dem Lauf.
Dazu braucht es Platz am Schritt im Datenmodell. Beides gehört vor der
Umsetzung entschieden und bestätigt, nicht stillschweigend angenommen —
was bei dieser Idee besonders schlecht aussähe.
