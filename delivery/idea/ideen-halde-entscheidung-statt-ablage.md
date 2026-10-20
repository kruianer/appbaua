---
titel: "Ideen-Halde — Vorschläge ohne Weg zur Entscheidung"
datum: 2026-10-08
---

## Problem/Nutzen

Der Ideen-Task (req-011) ist die einzige Prio dieses Systems, deren
Ergebnis **ausdrücklich ein Vorschlag** ist: Die Vision führt ihn als
"Neue Ideen für die App einbringen (als Vorschlag)" und verbietet im
selben Atemzug die Scope-Ausweitung — "Ideen gehen als Vorschlag in
Prio 5". Ein Vorschlag verlangt eine Entscheidung. Genau diese
Entscheidung hat in diesem System keinen Ort.

Der Befund ist messbar, nicht vermutet. In `delivery/idea/` liegen
heute **11 offene Ideen** mit zusammen rund 54 KB Text, in schöner
Regelmäßigkeit entstanden (2026-07-25, 07-26, 07-30, 08-13, 08-20,
08-27, 09-03, 09-10, 09-17, 09-24, 10-01). In `delivery/idea/done/`
liegt nach 75 Tagen **nichts außer `.gitkeep`**. Das ist kein Versäumnis
des Nutzers, sondern eine fehlende Mechanik: `lib/task-source.ts` kennt
`doneDir()` auch für die Ideen-Quelle, aber **keine Codestelle bewegt
jemals eine Idee dorthin**, und `grep -i idee` über `app/` und
`components/` findet null Treffer — die App, die alles andere zeigt
(Verlauf, Zustand, Aktivität, Vorschau), zeigt die Ideen überhaupt
nicht. Was der Worker nachts vorschlägt, existiert für den Betreiber nur
als eine Verlaufszeile "Neue Idee: xyz.md", die am nächsten Tag
weggescrollt ist.

Drei Folgen, die alle in die gleiche Richtung laufen:

- **Der Task frisst sich selbst.** Jeder Lauf muss laut Prompt
  (`ideaPrompt`, `lib/claude-runner.ts`) zuerst *alle* offenen und alle
  umgesetzten Ideen lesen und darf inhaltlich keine davon doppeln. Die
  Lesemenge wächst linear — heute 54 KB, bei gleichem Takt im Februar
  über 100 KB — und der Spielraum für etwas Neues schrumpft im
  Gegenzug. Der eingebaute Ausweg ist `NO_IDEA_MESSAGE` ("keine neue
  Idee gefunden"). Der Task hört also irgendwann auf zu liefern, und
  zwar als sauberer Erfolgsfall, nicht als Problem. Wieder das Muster,
  das dieses Repo mehrfach als seinen teuersten Fehlerfall benannt hat
  (siehe [Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md),
  [Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md)): ein
  Verstummen, das wie der Normalfall aussieht.
- **Die Halde veraltet unsichtbar.** Die Idee
  [Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md) vom
  20.08. argumentiert, ein toter Worker sei von Leerlauf nicht zu
  unterscheiden — inzwischen gibt es req-034, `lib/heartbeat.ts` und
  den `watchdog/`-Dienst, die einen Teil davon abdecken. Die Idee liegt
  unverändert als "offen" in `delivery/idea/` und geht jeden Lauf
  wieder als frischer, zu meidender Vorschlag in den Prompt ein. Von
  außen ist nicht unterscheidbar: noch unbeantwortet, inhaltlich
  erledigt, oder bewusst verworfen.
- **Es gibt keine Rückkopplung.** Die Richtungs-Vorgabe
  (`delivery/idea-direction.md`) ist der einzige Hebel am Ideen-Task,
  und sie wirkt nur *vorab* und nur grob. Dass eine konkrete Idee den
  Nutzer nicht überzeugt hat — und warum nicht — erfährt der Worker
  nie. Er schlägt weiter in dieselbe Richtung vor, ohne je ein Signal
  zu bekommen.

Nutzen:

- **Nachvollziehbarkeit** — zu jeder Idee ist sichtbar, ob und wie
  entschieden wurde und mit welcher Begründung, statt eines Ordners, in
  dem Angenommenes, Abgelehntes und Überholtes identisch aussehen.
- **Rock-solid Qualität** — der einzige Task, der sich selbst
  stillschweigend abschalten kann, verliert diese Eigenschaft: eine
  abgebaute Halde heißt wieder Luft für echte Vorschläge.
- **Ansprechende Visualisierung** — die Ideen bekommen eine eigene
  Ansicht mit Alter und Zustand statt elf Markdown-Dateien, die man
  einzeln öffnet.
- **Bessere Vorschläge** — die Entscheidung samt Grund geht in den
  nächsten Lauf ein; der Worker lernt die Vorlieben des Betreibers aus
  echten Entscheidungen, nicht nur aus der Richtungs-Datei.

## Skizze

**Kern:** Jede Idee bekommt einen **Entscheidungs-Zustand**, der im Repo
steht und in der App sichtbar und bedienbar ist — plus den Rückweg in
den Prompt, damit eine Entscheidung den nächsten Lauf tatsächlich
beeinflusst. Entscheiden tut ausschließlich der Mensch; der Worker führt
nur aus und erklärt.

**Zustände** (vier, bewusst wenige):

- **neu** — vorgeschlagen, unbeantwortet. Heute der einzige Zustand.
- **vorgemerkt** — der Nutzer will das, nur noch nicht jetzt. Bleibt in
  `delivery/idea/`.
- **verworfen** — mit Grund in einem Satz. Wandert nach
  `delivery/idea/declined/` (neues Gegenstück zum bestehenden `done/`).
- **umgesetzt** — wandert nach `delivery/idea/done/`, dem Ordner, den
  CLAUDE.md schon beschreibt und den bisher nichts befüllt.

Der Zustand steht als Frontmatter-Feld in der Idee selbst
(`status:`, `entschieden:`, `grund:`) — die Markdown-Datei bleibt die
Quelle der Wahrheit, wie überall sonst in `delivery/`. Git behält damit
die vollständige Entscheidungs-Historie, ohne dass dafür ein
Datenmodell-Umbau nötig wäre.

**Ansicht** (neue Seite "Ideen", Repo-weise wie die bestehenden
Repo-Zeilen, req-030): pro Idee eine Karte mit Titel, Datum, **Alter in
Tagen** und Zustands-Badge. Die Visualisierung macht genau das sichtbar,
was heute fehlt — das Liegenbleiben: eine Zeitachse der Vorschläge, auf
der unbeantwortete Ideen mit zunehmendem Alter sichtbar schwerer werden,
und darüber eine Kopfzeile wie "11 offen · älteste 75 Tage ohne
Antwort · 0 entschieden". Ein Klick öffnet den Volltext aus dem Repo.

**Bedienung:** drei Knöpfe pro Idee — *vormerken*, *verwerfen* (mit
Pflicht-Grund in einem Satz), *umgesetzt*. Für "verwerfen" ist der Grund
nicht Deko, sondern der eigentliche Ertrag: er ist das Lernsignal.

**Weg der Daten** — ohne neuen Mechanismus, mit dem was da ist:

1. Der Ideen-Lauf liest die Idee-Dateien ohnehin alle (das verlangt der
   Prompt). Er schreibt dabei zusätzlich einen schmalen Index pro Idee
   (Dateiname, Titel, Datum, Zustand, Grund) in den bestehenden Store —
   keine zusätzlichen Repo-Zugriffe, nur das Nebenprodukt eines Laufs,
   den es schon gibt.
2. Die App zeigt diesen Index und nimmt Entscheidungen auf. Sie schreibt
   dabei **nicht** selbst in Git — sie vermerkt die Entscheidung als
   offenen Auftrag.
3. Der nächste Ideen-Lauf des Repos materialisiert die Aufträge zuerst
   (Frontmatter setzen, Datei nach `done/` bzw. `declined/` verschieben)
   und committet sie mit den übrigen Änderungen auf `dev` — denselben
   Weg, den der Worker heute für die neue Idee schon geht. Erst danach
   schlägt er die Idee des Tages vor.
4. Im Prompt ersetzt dieser Zustand das heutige "lies alles und doppel
   nichts": gelesen werden offene und vorgemerkte Ideen im Volltext,
   verworfene und umgesetzte nur als Titel + Grund-Zeile ("nicht wieder
   vorschlagen, weil …"). Das senkt die Lesemenge pro Lauf, statt sie
   weiter wachsen zu lassen, und gibt dem Worker zum ersten Mal eine
   Rückmeldung.

**Begründete Weichen** (vorgeschlagen, nicht vorausgesetzt — No-Go
"keine stillen Architektur-Umbauten"):

- *Warum schreibt die App nicht direkt ins Repo?* Weil Git-Schreibzugang
  bisher ausschließlich beim Worker liegt und das eine Grenze ist, die
  eine Idee nicht nebenbei verschieben sollte. Der Preis ist Latenz: die
  Entscheidung landet erst beim nächsten Ideen-Lauf im Repo. Die Ansicht
  zeigt das offen an ("Entscheidung vermerkt, wird beim nächsten
  Ideen-Lauf ins Repo geschrieben"), statt es zu verstecken. Wer die
  Latenz nicht will, müsste der App einen eigenen Commit-Pfad geben —
  das wäre eine eigene Entscheidung des Betreibers, kein Nebeneffekt
  dieser Idee.
- *Warum kein automatisches Aufräumen?* Eine Idee, die 75 Tage
  unbeantwortet liegt, nach Frist selbst zu verwerfen wäre genau die
  Magie, die die Richtungs-Vorgabe verbietet. Alter wird **angezeigt**,
  nie verwertet.

**Abgrenzung / Out of Scope:**

- Keine Umsetzung von Ideen und kein automatisches Erzeugen von
  Requirements daraus. "Vorgemerkt" heißt vorgemerkt; ob daraus ein
  Requirement wird, bleibt der Weg über den Requirements-Skill und damit
  beim Menschen.
- Das Human-Gate bleibt unberührt: entschieden wird vom Nutzer, die
  Dateiänderungen gehen wie jede Worker-Arbeit nach `dev` und nach prod
  nur über das bestehende Gate.
- Kein Bewerten/Priorisieren von Ideen durch den Worker (kein Score,
  kein Ranking) — er stellt dar und führt aus, er urteilt nicht über
  seine eigenen Vorschläge.
- Ideen anderer Repos als appbaua: dieselbe Mechanik, ohne Sonderfall —
  die Ansicht ist repo-weise, weil die Ordner repo-weise sind.
