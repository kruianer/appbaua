---
titel: "Liegengeblieben — failed/ ist heute eine Einbahnstraße"
datum: 2026-10-01
---

## Problem/Nutzen

Die Paket-Warteschlange dieses Systems hat vier Fächer: `ready/`,
`in-progress/`, `done/` und `failed/`. Der Worker liest ausschließlich
`ready/` (die älteste .md, `lib/task-source.ts`) und — seit req-036 —
`in-progress/`. In `failed/` schaut er nie wieder hinein. Damit ist
`failed/` der einzige Ort in dieser Pipeline, aus dem es keinen Weg
zurück gibt: `lib/task-source.ts` kennt `failedDir()`, aber **keine
Ansicht der App liest diesen Ordner** — kein Dashboard, keine
Repo-Zeile, keine Zustandsseite. Was dort landet, verschwindet nach
einem einzigen Verlaufseintrag aus dem Blickfeld.

Dass Pakete dort auch ohne eigenes Verschulden landen, ist belegt:
bug-019 dokumentiert, wie am 22.08. in `livinggardentwin` drei Pakete
(`bug-039`, `req-034`, `req-035`) nach `failed/` wanderten, weil die
Claude-Anmeldung abgelaufen war — „an den Paketen war nichts falsch".
Der Fix von bug-019 hat **eine** Ursache geschlossen (bei abgelaufener
Anmeldung bleibt die .md in `ready/`); er hat keinen Weg aus `failed/`
heraus geschaffen. Die übrigen Wege hinein stehen weiter offen: ein
Netzwerk-Timeout mitten im Lauf (bug-020), eine Testsuite, die der
Worker im selben Lauf nicht grün bekommt (req-019, Schritt 4), oder die
Kategorie „Sonstiges" aus req-037. Bei der ersten Variante ist das
Paket Opfer der Umgebung, bei der zweiten ein echter inhaltlicher
Fehlschlag — in `failed/` sehen beide identisch aus.

Der Kontrast macht die Lücke scharf: Für `in-progress/` existiert der
Rückweg längst. `lib/execute-step.ts` holt liegengebliebene
Etappen-Pakete von dort nach `ready/` zurück, damit kein Paket in einem
halben Zustand stehenbleibt. Genau dieser Mechanismus fehlt dem Fach
daneben — obwohl dort die Pakete liegen, die der Nutzer tatsächlich
angefordert hat.

Daraus entsteht wieder das Muster, das dieses Repo mehrfach als
teuersten Fehlerfall benannt hat (siehe
[Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md),
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md),
[Abnahme-Mappe](abnahme-mappe-vor-dem-human-gate.md)) — ein Zustand,
der wie der gute Normalfall aussieht. Hier trifft er die Warteschlange
selbst: Sind alle `ready/`-Ordner leer, zeigt die App „Leerlauf — nichts
zu tun" (req-021/req-022) und meint damit auch dann „fertig", wenn
daneben drei Requirements des Nutzers im Fehlschlag-Fach verstauben. Der
Betreiber müsste von sich aus auf die Idee kommen, in einem Ordner
nachzusehen, den die App ihm nie zeigt.

Nutzen:

- **Rock-solid Qualität** — kein vom Nutzer angefordertes Paket geht
  still verloren. Umgebungsbedingte Fehlschläge (Netz, Session, Timeout)
  kommen zurück in die Schlange, statt einen Auftrag zu verbrennen.
- **Nachvollziehbarkeit** — an jedem liegengebliebenen Paket steht,
  warum es liegt, seit wann, wie oft es das schon versucht hat und was
  es als Nächstes braucht: einen weiteren Versuch oder eine
  Entscheidung des Menschen.
- **Ansprechende Visualisierung** — die Warteschlange wird als Strecke
  mit Abzweig sichtbar (`ready → in Arbeit → done`, daneben der
  Fehlschlag-Zweig), mit Alter statt nur Anzahl — ein Fach, das altert,
  ist ein Auftrag, der vergessen wird.
- **Ehrliches Leerlauf-Signal** — „nichts zu tun" bedeutet wieder, was
  es sagt.

## Skizze

**Kern:** `failed/` wird von einer Endstation zu einer Wiedervorlage —
sichtbar, gealtert, und mit genau zwei Wegen heraus: automatisch bei
Umgebungsfehlern, auf Knopfdruck bei allem anderen.

**1. Das Fach wird sichtbar.** Je Repo eine Liste der Pakete in
`failed/`: Kennung und Titel, Task-Typ, Fehlerart (die Kategorien aus
req-037 stehen schon an den Verlaufseinträgen — `lib/error-kind.ts`),
Zeitpunkt, Zahl der Versuche und ein Link auf den Verlaufseintrag, der
das Paket dorthin geschoben hat. Auf dem Dashboard eine Zeile, die man
nicht suchen muss: „2 Pakete liegengeblieben · ältestes seit 11 Tagen".

**2. Die Fehlerart entscheidet über den Rückweg.** Das ist der inhaltliche
Kern der Idee, und er ist schon vorbereitet, weil req-037 die Fehlerart
als eigenes Merkmal führt:

- **Umgebung** (Netzwerk, Rate-/Session-Limit, Anmeldung abgelaufen,
  Zeitüberschreitung) — nicht die Schuld des Pakets. Es wandert
  automatisch zurück nach `ready/`, mit einem sichtbaren Eintrag im
  Verlauf: „`req-034` nach `ready/` zurückgelegt — Fehlschlag war
  Netzwerk, Versuch 2 von 3".
- **Inhalt** (Testsuite bleibt rot, „Sonstiges") — hier ist das Paket
  tatsächlich gescheitert. **Kein** Automatismus: Es bleibt liegen und
  wartet auf den Menschen.

**3. Eine Aktion für den Menschen.** Am inhaltlich gescheiterten Paket
genau ein Knopf: „nochmal versuchen" (zurück nach `ready/`). Mehr nicht
— kein Verwerfen, kein Bearbeiten in der App. Wer das Paket umschreiben
will, tut das in der .md, wie bisher.

**4. Eine Obergrenze, damit daraus keine Schleife wird.** bug-002
(„heißlaufender Worker, Dauerfehler") ist der Grund, warum ein
unbegrenztes Zurücklegen schlimmer wäre als das heutige Verschwinden.
Deshalb: ein Versuchszähler am Paket, und nach der dritten
umgebungsbedingten Rückkehr endet die Automatik. Das Paket bleibt dann
ausdrücklich als „blockiert — braucht eine Entscheidung" stehen, statt
weiter im Kreis zu laufen. Die Fehlschlag-Historie bleibt am Paket
lesbar; ein zweiter Fehlschlag darf nicht wieder wie der erste aussehen.

**5. Das Bild.** Die Warteschlange je Repo als waagerechte Strecke:
`ready → in Arbeit → done`, und als Abzweig nach unten der
Fehlschlag-Zweig. Jedes liegengebliebene Paket eine Karte darauf, deren
Länge/Färbung ihr Alter zeigt, mit einem kleinen Pfeil zurück nach
`ready` bei denen, die automatisch wiederkommen. Auf einen Blick
erkennbar: Fließt die Schlange, oder sammelt sich etwas im Abzweig?

**6. Ehrlichkeits-Regel.** Solange in irgendeinem Repo ein Paket in
`failed/` liegt, darf der Leerlauf nicht als „nichts zu tun" dargestellt
werden. Die Begründung aus req-021/req-022 bekommt einen Zusatz: „keine
offenen Pakete in `ready/` — aber 2 liegengeblieben". Ohne diese Regel
reproduziert die Idee genau das Problem, das sie behebt.

**Abgrenzung / bewusst NICHT Teil davon:**

- **Kein Anfassen des Human-Gates.** Alles hier passiert vor `dev`, in
  der Arbeitsschlange. Kein Merge nach `main`, kein prod-Deploy, keine
  Änderung an der Promotion.
- **Kein automatischer Wiederversuch bei inhaltlichem Fehlschlag.** Eine
  rote Testsuite, die der Worker nicht grün bekommt, bleibt eine
  Entscheidung des Menschen. Sonst entsteht genau die Magie, die die
  Ideen-Richtung als No-Go nennt.
- **Kein Ersatz für req-037.** req-037 erklärt, *warum* ein Lauf
  scheiterte; diese Idee entscheidet, *was mit dem Paket danach
  passiert*. Die Fehlerart ist das Scharnier zwischen beiden.
- **Keine neue Ordner-Konvention.** `ready/in-progress/done/failed`
  bleibt, wie es ist.
- **Kein automatisches Löschen oder Archivieren** alter
  Fehlschlag-Pakete.

**Offene Weiche (zu entscheiden, nicht vorauszusetzen):** Wo lebt der
Versuchszähler? Im Frontmatter der .md — dann steht die
Fehlschlag-Historie im Git, überlebt einen Datenbankverlust und ist
auch ohne App lesbar, aber der Worker schreibt in die Paket-Datei des
Nutzers. Oder in der App-Datenbank — sauberer getrennt, aber der Zähler
ist weg, wenn das Volume weg ist (siehe
[Backup-Drill](backup-mit-restore-drill-nachweis.md)). Die
`.md`-Variante wirkt robuster und passt zum Etappen-Gedächtnis aus
req-036; das gehört vor der Umsetzung mit dem Nutzer entschieden —
ebenso die konkrete Zahl der automatischen Versuche.
