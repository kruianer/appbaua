---
id: bug-006
app: appbaua
req: req-017
priority: high
created: 2026-07-26
---

# Observed

Die Test-Suite bricht ab: `lib/doc-screenshots.ts` importiert
`playwright-core`, aber das Paket lässt sich nicht auflösen ("Failed to
resolve import 'playwright-core' from 'lib/doc-screenshots.ts'. Does the
file exist?"). Dadurch scheitern beim Laden gleich mehrere Testdateien,
die (direkt oder über Import-Ketten) an `doc-screenshots.ts` hängen:
`lib/doc-screenshots.test.ts`, `lib/execute-step.test.ts` und
`lib/worker-loop.test.ts`.

# Expected

`playwright-core` (bzw. die verwendete Playwright-Abhängigkeit) ist als
Dependency in der package.json deklariert und installiert, sodass
`lib/doc-screenshots.ts` importierbar ist und die Test-Suite ohne
Auflösungsfehler durchläuft. `npm test` läuft wieder komplett grün.

# Steps

1. `npm test` ausführen.
2. Die vier fehlschlagenden Testdateien beobachten; Wurzel ist der nicht
   auflösbare `playwright-core`-Import in `lib/doc-screenshots.ts`.
