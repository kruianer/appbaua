---
id: bug-015
app: appbaua
req: req-019
priority: high
created: 2026-07-27
---

# Observed

Der Worker kam bei appbaua an keiner Aufgabe mehr vorbei: drei Läufe
hintereinander endeten mit "Test-Suite rot", ohne dass er etwas
committen konnte (27.07., 18:56 / 19:46 / 20:13 UTC). Betroffen waren
bug-009 und req-030, beide landeten unbearbeitet in `failed/`.

Der Fehler:

```
Error: act(...) is not supported in production builds of React.
 ❯ exports.act node_modules/react/cjs/react.production.js:361:9
 ❯ app/login/page.test.tsx:35:5
```

Dieselbe Suite ist lokal (Windows) und in CI grün — rot ist sie nur im
Worker-Container.

# Expected

Das Test-Gate bewertet die Suite so, wie sie überall sonst läuft. Eine
Suite, die grün ist, darf nicht allein deshalb rot gemeldet werden, weil
sie im Worker-Container läuft.

# Steps

1. Im Worker-Container `npx vitest run app/login/page.test.tsx` ausführen.
2. Alle React-Tests scheitern mit "act(...) is not supported in
   production builds of React".

# Ursache

Der Worker-Container setzt `NODE_ENV=production`, und `run` vererbt das
an jedes Kindprozess. React lädt dann `react.production.js` — einen
Build, in dem `act()` fehlt, weil es reines Test-Werkzeug ist. Jedes
`render()` aus React Testing Library scheitert daran.

Das ist derselbe Ursachentyp wie bug-010, nur eine Stufe später:
Damals wurde `DEV_INSTALL_ENV` eingeführt, damit der *Install*-Schritt
devDependencies zieht. Der *Testlauf* blieb bewusst im
Container-Environment — der Kommentar im Code sagte es ausdrücklich
("the test command below still runs in the normal environment"). Genau
diese Entscheidung war falsch: Ein Testlauf ist eine
Entwicklungstätigkeit, und unter `NODE_ENV=production` testet er einen
anderen Build als den, gegen den die Tests geschrieben wurden.

Nicht auf React beschränkt — jede Bibliothek mit getrenntem
Production-Build kann so Test-Hooks verlieren.

# Behoben am 2026-07-27

`DEV_INSTALL_ENV` → `DEV_TEST_ENV` (alter Name bleibt als Alias) und
zusätzlich an den Testlauf übergeben, nicht nur an den Install.
Regressionstest in `lib/test-gate.test.ts`; der alte Test, der
`testCall.env === undefined` festschrieb, wurde entsprechend korrigiert
— er hatte das falsche Verhalten fixiert.
