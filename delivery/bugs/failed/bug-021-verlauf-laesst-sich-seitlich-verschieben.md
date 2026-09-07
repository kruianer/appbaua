---
id: bug-021
app: appbaua
req: req-005
priority: normal
created: 2026-09-07
---

# Observed

Der Verlauf lässt sich nicht nur nach oben und unten scrollen, sondern
auch nach links und rechts verschieben. Beim Lesen rutscht die Anzeige
seitlich weg, und man muss sie zurückschieben.

# Expected

Vertikal scrollen ja, seitlich verschieben nicht. Die Anzeige passt sich
in die Breite des Bildschirms ein — auf jedem Gerät, ohne dass etwas über
den Rand hinausragt.

# Steps

1. Die Aktivitätsseite öffnen und einen Verlaufseintrag aufklappen.
2. Nach links oder rechts wischen bzw. mit dem Mausrad seitlich scrollen:
   die Anzeige verschiebt sich.

# Hinweis zur Ursache

Der Verlaufsbereich in `components/AppShell.tsx` (Zeile ~438) begrenzt
nur die Höhe:

```
<div style={{ flex: 1, overflowY: "auto", padding: "0 20px 14px" }}>
```

`overflowY: "auto"` regelt das vertikale Scrollen; für die Breite gibt es
keine Vorgabe. Etwas im Inhalt ist damit breiter als der Bereich und
schiebt ihn auf.

Naheliegende Verursacher, bitte prüfen statt raten:

- Die Live-Ausgabe des Workers enthält lange Zeilen ohne Leerzeichen
  (Dateipfade, JSON, Base64). Ohne Umbruchregel wächst der Block über die
  verfügbare Breite hinaus.
- `whiteSpace: "nowrap"` steht an mehreren Stellen (Zeilen ~549, ~560,
  ~840). Wo der Text umbrechen darf, ist das falsch; wo er es nicht darf,
  braucht es stattdessen ein Abschneiden mit Auslassungspunkten.

Der Fix soll die Ursache beheben, nicht das Symptom: Ein
`overflowX: "hidden"` auf dem äußeren Bereich würde das seitliche
Verschieben zwar unterbinden, aber den überstehenden Inhalt unlesbar
abschneiden. Besser ist, dass der Inhalt von vornherein passt — lange
Zeichenketten umbrechen, wo sie es dürfen.

Betrifft alle Bildschirmbreiten, fällt aber auf schmalen Geräten am
stärksten auf.
