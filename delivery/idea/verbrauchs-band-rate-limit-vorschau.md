---
titel: "Verbrauchs-Band — das Rate-Limit kommen sehen statt es zu erleiden"
datum: 2026-09-03
---

## Problem/Nutzen

Das Rate-/Usage-Limit ist der einzige Engpass dieses Systems, den der
Worker regelmäßig tatsächlich erreicht: req-029 gibt es nur deshalb, und
bug-011 ("Rate-Limit-Pause greift nicht") zeigt, dass der Fall im Betrieb
real vorkommt. req-029 regelt aber ausdrücklich nur die **Reaktion** —
"Verhindern, DASS ein Rate-Limit auftritt" steht dort wörtlich unter *Out
of Scope*. Das Ergebnis: Das Limit ist heute für den Betreiber ein
Ereignis, das ihn ohne Vorwarnung trifft, mitten in einem Schritt, und
das er erst bemerkt, wenn die Aktivitätskarte "Pause wegen Rate-Limit bis
HH:MM" zeigt.

Bis dahin ist der Verbrauch komplett unsichtbar. Die App weiß heute nicht
— und zeigt daher nirgends —, wie viel ein einzelner Schritt gekostet
hat, welches Repo oder welcher Task-Typ das Budget aufzehrt, oder wie
weit das laufende Limit-Fenster schon gefüllt ist. Damit fehlt auch die
Entscheidungsgrundlage für den einen Hebel, den der Betreiber wirklich
hat: die Modellwahl pro Repo (req-028). Ob Opus für ein bestimmtes Repo
die Nacht auffrisst oder kaum ins Gewicht fällt, ist derzeit reine
Vermutung.

Dazu kommt das Muster, das dieses Repo bereits mehrfach als teuersten
Fehlerfall benannt hat (siehe
[Schritt-Beleg](schritt-beleg-quality-gate-nachweis.md),
[Backup-Drill](backup-mit-restore-drill-nachweis.md),
[Worker-Herzschlag](worker-herzschlag-haenger-erkennung.md)): ein
Ausfall, der wie der Normalfall aussieht. Eine Nacht, in der der Worker
nach zwei Schritten am Limit hing und den Rest verschlief, sieht im
Verlauf morgens fast genauso aus wie eine ruhige Nacht mit wenig zu tun —
seit req-021 werden Leerlauf-Einträge sogar zusammengefasst. Der Grund
"das Budget war weg" ist nirgends ablesbar.

Nutzen:

- **Rock-solid Qualität** — das Limit wird planbar statt überraschend;
  der Betreiber kann gegensteuern (Modell, Repo-Prio, Zeitfenster),
  bevor eine Nacht verloren geht, statt danach.
- **Nachvollziehbarkeit** — jeder Schritt trägt sichtbar, was er
  verbraucht hat; "warum kam heute Nacht nichts mehr" bekommt eine
  Antwort.
- **Ansprechende Visualisierung** — ein füllendes Band mit Prognose-Linie
  statt einer Zahlenkolonne, dazu eine Verteilung nach Repo × Task-Typ ×
  Modell.
- **Entscheidungsgrundlage für req-028** — die Modellwahl pro Repo wird
  eine gemessene Entscheidung statt einer Bauchentscheidung.

## Skizze

**Kern:** Der Worker liest die Claude-Läufe ohnehin schon als
`--output-format stream-json` ein
([lib/claude-runner.ts](../../lib/claude-runner.ts)). Der abschließende
Ergebnis-Datensatz eines solchen Laufs führt die Verbrauchsangaben
(Ein-/Ausgabe-Token, Cache-Anteile, Dauer) bereits mit — sie werden heute
nur verworfen. Die Idee ist, genau diese ohnehin vorbeifließende Zahl am
Schritt festzuhalten, zusammen mit Repo, Task-Typ und dem verwendeten
Modell (req-027/req-028 kennen es bereits). **Kein zusätzlicher Aufruf,
kein zweiter Mechanismus, keine externe Abfrage** — nur: nicht mehr
wegwerfen.

**Darstellung 1 — Verbrauchszeile am Schritt** (passt neben die
Modellangabe der Aktivitätskarte bzw. in die aufklappbare Repo-Zeile,
req-030):

```
✓ Requirements × appbaua — req-036-…md
  Modell Opus · 4 min 12 s · 186k ein / 21k aus (davon 142k Cache)
```

**Darstellung 2 — Verbrauchs-Band des laufenden Fensters:** ein schmales
horizontales Band, das sich im Lauf des Limit-Fensters füllt, mit einer
gestrichelten Prognose-Linie:

```
⚡ Verbrauch · laufendes Fenster
   ▓▓▓▓▓▓▓▓▓▓▓▓▓░░░░░░░░  gemessen: 13 Schritte seit 22:04
   ⌁ bei diesem Tempo Fenster leer gegen ~04:10   (Prognose)
   letzter bekannter Reset: 2026-09-02, 05:00 (aus Limit-Meldung)
```

Die Prognose ist als Prognose markiert, nicht als Zusage — genau wie die
Vorschau "als Nächstes voraussichtlich" aus req-022, an deren
Formulierung sie sich anlehnt.

**Darstellung 3 — Verbrauchs-Verteilung (letzte N Tage):** gestapelte
Balken nach Repo, aufgeschlüsselt nach Task-Typ und Modell. Damit ist in
einem Blick beantwortet, was heute niemand weiß: ob die Hintergrund-Tasks
(P3–P5) oder die eigentliche Arbeit (P1/P2) das Budget verbrauchen — und
ob ein einzelnes Repo mit teurem Modell den Rest ausbremst.

**Ehrlichkeits-Regeln (im Sinne der Schritt-Beleg-Idee):**

- Ein Schritt ohne erfasste Verbrauchsangabe steht als **"nicht erfasst"**
  grau da und wird nie als 0 verbucht — sonst sähe ein nicht gemessener
  Lauf sparsamer aus als ein gemessener.
- Das Band zeigt **gemessenen Eigenverbrauch**, nicht das echte
  Kontolimit des Betreibers: Wo dieses Limit unbekannt ist, wird keine
  Prozentzahl erfunden; das Band zeigt dann Tempo und Prognose relativ
  zum letzten bekannten Reset-Zeitpunkt aus einer Limit-Meldung
  (req-029), klar so benannt.
- Eine Nacht, die wegen einer Rate-Limit-Pause früh endete, wird im
  Verlauf als solche kenntlich und nicht in die Leerlauf-Zusammenfassung
  (req-021) hineingeglättet.

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene auf Basis von Daten, die
im Lauf ohnehin schon anfallen. **Kein** automatisches Herunterschalten
des Modells, **keine** automatische Drosselung und **keine** Änderung der
Auswahl-Logik oder der Zeitfenster — die Idee legt den Verbrauch offen
und überlässt jede Konsequenz dem Menschen; sie nimmt ihm ausdrücklich
keine Entscheidung ab und rührt das prod/main-Gate nicht an. Auch keine
Euro-Kostenrechnung, solange nur Abo-Limits gelten — das wäre eine
erfundene Zahl. Ob und wo der Verbrauch am Schritt abgelegt wird
(Datenmodell) sowie die Länge des betrachteten Fensters sind vor der
Umsetzung zu bestätigen, nicht stillschweigend vorauszusetzen.
