---
id: bug-007
app: appbaua
req: req-014
priority: normal
created: 2026-07-26
---

# Observed

Der Test `lib/dashboard.test.ts` > "buildDashboard tiles > counts due
task types (all always-on = 5)" schlägt fehl: `expected 6 to be 5`. Seit
neue wiederkehrende Task-Typen dazugekommen sind (Security aus req-014,
Doku aus req-016), zählt das Dashboard 6 fällige Task-Typen, der Test
erwartet aber noch 5.

# Expected

Der Dashboard-Zähler und der zugehörige Test spiegeln die tatsächliche
Anzahl der Task-Typen wider (jetzt inkl. Security und Doku). Der Test
läuft grün — entweder durch Anpassen der erwarteten Zahl auf die korrekte
aktuelle Task-Typ-Anzahl oder durch eine gegen das Hinzufügen von
Task-Typen robuste Prüfung.

# Steps

1. `npx vitest run lib/dashboard.test.ts` ausführen.
2. Fehlschlag "expected 6 to be 5" in Zeile ~69 beobachten.
