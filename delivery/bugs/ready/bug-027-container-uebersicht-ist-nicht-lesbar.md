---
id: bug-027
app: appbaua
req: req-042
priority: normal
created: 2026-10-18
---

# Observed

Die Container-Übersicht zeigt alles, was sie zeigen soll — aber sie ist
zum Ablesen gebaut, nicht zum Erfassen. Was ich wissen will ("wer frisst
den Speicher?"), muss ich mir aus Zahlen zusammensuchen.

Im Einzelnen:

1. **Keine Visualisierung.** Speicher und CPU stehen als nackte Zahlen
   in einer Textzeile. Bei über fünfzig Containern sagt mir
   "154.8 MB" nichts, solange ich nicht alle anderen auch gelesen habe.
2. **Alle Gruppen untereinander.** Auf dem Laptop bleibt die halbe
   Breite leer, und ich muss scrollen, um zwei Apps zu vergleichen.
3. **Der Neustart-Knopf ist riesig.** Er trägt den ganzen
   Containernamen als Beschriftung — bei
   `appbaua-prod-health-agent-1 neu starten` ist der Knopf breiter als
   die Zeile, die er begleitet, und drängt sich in jeder Zeile auf.
4. **Nur eine Summe je Gruppe, klein und grau.** Die Gesamtsumme über
   alle Container fehlt ganz — also genau die Zahl, die sagt, wie es
   dem Rechner geht.

# Expected

Die Übersicht beantwortet die Frage "wo geht der Speicher hin?" auf
einen Blick, ohne Zahlen zu vergleichen.

- **Balken statt Zahlen.** Je Container ein Balken für den Speicher,
  dessen Länge im Verhältnis zum größten Container steht — der größte
  füllt die Breite, alle anderen entsprechend weniger. Die Zahl bleibt
  daneben stehen, aber sie ist nicht mehr die einzige Auskunft. Für
  CPU dasselbe.
- **Auf dem Laptop zwei Gruppen nebeneinander**, auf dem iPhone eine.
- **Neustart als reines Symbol** am Zeilenende, ohne Text. Die
  Sicherheitsabfrage bleibt, wie sie ist — sie nennt den Namen
  ohnehin.
- **Eine Summenzeile je Gruppe** (Speicher und CPU aller Container
  dieser App) und **eine Gesamtsumme** über alle Gruppen.

# Steps

1. Menüpunkt "Zustand" öffnen, zur Container-Übersicht wechseln.
2. Versuchen, ohne Lesen zu erkennen, welche App am meisten Speicher
   braucht. Es geht nicht — man muss alle Zahlen vergleichen.

# Hinweis zur Ursache

Die Daten sind vollständig da. `lib/container-overview.ts` liefert je
Container `memoryBytes` und `cpuPercent`, je Gruppe
`memoryBytesTotal`. Es fehlt allein die Darstellung in
`components/ContainerOverview.tsx`:

- `ContainerRowView` (Zeile 198) setzt Name, Zustand, Speicher und CPU
  als gleichrangige Textfelder nebeneinander.
- Der Knopf trägt `{c.name} neu starten` als Beschriftung.
- Die Gruppenkarten liegen in einer einspaltigen Flex-Spalte.

Richtung für den Fix — bitte selbst abwägen:

**Der Bezugswert der Balken.** Das Verhältnis zum größten Container ist
nur ein Vorschlag. Denkbar wäre auch der Anteil am Gesamtspeicher des
Rechners. Gegen Letzteres spricht: Der größte Container hält derzeit
rund 380 MB von 11,8 GB — alle Balken wären ein Strich, und man sähe
wieder nichts. Der Vergleich untereinander zeigt mehr.

**Ein Sonderfall, der heute auffällt:** Ein Container kann weit über
allen anderen liegen (bei der Messung am 17.10. hielt
`wellarita-dev-app-1` 6,5 GB, der zweitgrößte 155 MB). Dann sind alle
übrigen Balken unsichtbar kurz. Das will bedacht sein — es ist aber
kein Grund, die Verhältnisdarstellung aufzugeben: Dass ein Container
alle anderen erdrückt, IST die Auskunft, die man sehen will.

Zu bedenken: Ein beendeter Container hat keine CPU-Last (req-042) —
er bekommt keinen leeren Balken, sondern gar keinen.

# Out of Scope

- Die Messung selbst und wie oft sie läuft.
- Ein Verlauf über die Zeit (Kurven).
- Eine Warnung, wenn ein Container zu viel braucht.
- Sortieren oder Filtern der Gruppen.
