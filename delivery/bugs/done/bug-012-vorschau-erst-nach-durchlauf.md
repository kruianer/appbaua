---
id: bug-012
app: appbaua
req: req-022
priority: normal
created: 2026-07-27
---

# Observed

Die Liste "Nächste Aktivitäten" wird erst aktualisiert, wenn ein
kompletter Worker-Durchlauf fertig ist. Läuft gerade ein langer Schritt
(bis zu einer Stunde), sehe ich die ganze Zeit einen veralteten Stand und
kann nicht erkennen, wie viel noch in der Queue liegt.

Ursache liegt offen: `updatePreview()` wird in `lib/worker-loop.ts` nur
ein einziges Mal aufgerufen, am ENDE von `runOnce()` (aktuell Zeile 231).

# Expected

Die Vorschau wird zu Beginn eines Durchlaufs aufgebaut, nicht erst danach
— so sehe ich sofort, was ansteht, ohne auf das Ende eines womöglich
einstündigen Schritts warten zu müssen. Die Aktualisierung am Ende darf
bleiben (der Stand ändert sich ja durch die getane Arbeit), aber der
Durchlauf soll nicht mehr damit BEGINNEN, dass die Vorschau veraltet ist.

# Steps

1. Worker starten, während mehrere Requirements/Bugs in `ready/` liegen.
2. Aktivitätsseite ansehen, solange der erste Schritt noch läuft: "Nächste
   Aktivitäten" zeigt den Stand von vor dem Durchlauf.
