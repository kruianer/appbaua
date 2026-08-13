---
titel: "Sicherheits-Befund-Verlauf statt loser Berichts-Dateien"
datum: 2026-08-13
---

## Problem/Nutzen

Der Security-Task (req-014) legt bei jedem Fund einen neuen, in sich
abgeschlossenen Bericht unter `delivery/security/` ab (req-010 —
ausdrücklich ohne Browsing-UI, "nur die Datei im Repo"). Ein Blick in
die drei bisherigen Berichte zeigt das Muster deutlich: Finding 1
("HTTPS wird am Edge nicht erzwungen") steht seit dem ersten Bericht vom
2026-07-29 unverändert offen — auch im Bericht vom 2026-08-05 und noch
im Bericht vom 2026-08-12, jedes Mal mit dem Vermerk "unverändert" im
Fließtext. Diese Wiederholung ist aber nur erkennbar, wenn jemand alle
drei Markdown-Dateien öffnet und Wort für Wort vergleicht — die App
selbst zeigt nirgends, dass ein Befund seit drei Läufen (gut zwei
Wochen) unbehoben ist.

Genau das ist die Lücke: Ein einzelner Bericht sieht immer gleich
"vollständig" aus, egal ob ein Finding brandneu ist oder seit Wochen
ignoriert wird. Für einen Worker, der öffentlich einsetzbar sein soll,
ist "wir haben das schon dreimal gefunden und nichts ist passiert" eine
andere Dringlichkeitsstufe als ein frischer Fund — diese Unterscheidung
geht heute in loser Datei-Ablage komplett verloren.

Nutzen:

- **Rock-solid Qualität** — wiederkehrende, unbehobene Risiken fallen
  auf, statt sich hinter "es gibt ja einen Bericht" zu verstecken.
- **Nachvollziehbarkeit** — auf einen Blick sichtbar, seit wann ein
  Befund offen ist und wie oft er bereits bestätigt wurde, statt drei
  Dateien vergleichen zu müssen.
- **Ansprechende Visualisierung** — ein Zustand (offen seit X Läufen /
  neu / behoben) statt reiner Text-Report-Liste.

## Skizze

**Kern:** Der Security-Task bekommt neben der bestehenden Berichts-Datei
(unverändert, bleibt Quelle der Wahrheit für den Volltext) einen
zweiten, schmalen Schritt: er ordnet jedes Finding des neuen Laufs einem
Finding aus dem letzten Bericht desselben Repos zu (gleicher/ähnlicher
Titel/Kurzbeschreibung reicht als Heuristik) und vergibt einen Status:

- **neu** — taucht zum ersten Mal auf.
- **weiterhin offen (seit N Läufen)** — war schon im letzten Bericht da.
- **behoben** — stand im letzten Bericht, fehlt im aktuellen.

Diese Zuordnung ist reine Lese-/Vergleichs-Logik über die bereits
abgelegten Berichte hinweg — kein neuer Prüfmechanismus, keine Änderung
daran, WAS geprüft wird.

**Darstellung — Findings-Übersicht (z.B. auf der Repo-Detailseite oder
unter den Review-Berichten):**

```
🛡 Sicherheits-Befunde · appbaua
   ⚠ HTTPS wird am Edge nicht erzwungen        offen seit 3 Läufen (2026-07-29)
   ⚠ Keine dokumentierte Backup-Erwartung      offen seit 2 Läufen (2026-08-05)
   ⚠ nanoid-Advisory im Dependency-Audit       neu (2026-08-12)
```

Ein Befund, der über mehrere Läufe hinweg offen bleibt, wird optisch
zunehmend dringlicher markiert (z.B. Farbverlauf grau→gelb→orange nach
Anzahl Läufe), damit "seit Wochen ignoriert" nicht dieselbe Anmutung hat
wie "gerade erst gefunden".

**Ehrlichkeits-Regel:** "behoben" wird nur gezeigt, wenn der Task
tatsächlich lief und das Finding fehlt — nicht, wenn der Task
übersprungen wurde (dann bleibt der letzte bekannte Status stehen, klar
mit Zeitstempel des letzten Laufs versehen, kein stillschweigendes
Verschwinden).

**Abgrenzung:** Reine Nachweis- und Sicht-Ebene auf Basis der ohnehin
entstehenden Berichte. Kein Aufweichen des Human-Gates, keine
automatische Behebung von Findings, keine Änderung der Prüfkriterien
selbst (`delivery/security.md` bzw. Best-Practice-Fallback). Die
Zuordnungs-Heuristik (wann gilt ein Finding als "dasselbe" über zwei
Berichte hinweg) ist vor der Umsetzung zu bestätigen, nicht
stillschweigend vorauszusetzen.
