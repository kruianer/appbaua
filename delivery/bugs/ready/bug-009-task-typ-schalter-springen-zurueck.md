---
id: bug-009
app: appbaua
req: req-002
priority: high
created: 2026-07-26
---

# Observed

Task-Typ-Schalter springen ohne mein Zutun zurück.

Zuletzt beobachtet **auf prod am 27.07., ohne jeden Deploy**: Ich habe
`code-review`, `security` und `ideen` eingeschaltet — wenige Minuten
später waren sie wieder deaktiviert. Kein Deployment, kein Neustart, kein
weiterer Klick von mir dazwischen.

(Die ursprüngliche Fassung dieses Bugs vermutete den Reset "beim
Deployment". Das war zu eng gefasst und vermutlich der Grund, warum der
Fix-Versuch scheiterte: es passiert auch im laufenden Betrieb.)

# Expected

Ein Schalter, den ich umlege, bleibt so — bis ich ihn selbst wieder
ändere. Weder ein laufender Worker-Durchlauf noch eine andere gleichzeitige
Änderung darf ihn zurücksetzen.

# Steps

1. In der Task-Steuerung (prod) einen deaktivierten Typ einschalten, z.B.
   `code-review`.
2. Ein paar Minuten warten, während der Worker weiterläuft.
3. Seite neu laden: der Typ steht wieder auf inaktiv.

# Hinweis zur Ursache (Verdacht, bitte reproduce-first verifizieren)

Alle Schreibpfade in `lib/task-service.ts` (`toggleTaskType`,
`toggleAlways`, `reorderTaskTypes`, `setDaySchedule`) arbeiten nach dem
Muster **list() → verändern → replace(GESAMTE Liste)**. `replace()` ist in
`lib/pg-store.ts` ein `DELETE FROM task_types` plus kompletter Neu-Insert.

Damit überschreibt jeder Schreibvorgang die ganze Liste auf Basis eines
Standes, der beim Schreiben bereits veraltet sein kann — ein klassischer
Lost Update. Zwei Kandidaten dafür, dass zwischendurch jemand anders
schreibt:

1. **Der Worker-Prozess** liest `listTaskTypes()` mehrfach pro Durchlauf
   (`lib/worker-loop.ts`, u.a. Zeilen 89, 111, 129). Der
   `seedMissingDefaults`-Wrapper in `lib/task-store.ts` SCHREIBT beim
   Lesen zurück, sobald `withMissingDefaults` etwas ergänzt — ein `list()`
   mit Schreib-Nebenwirkung, mehrmals pro Minute, aus einem zweiten
   Container gegen dieselbe DB.
2. **Die Web-App** baut ihren `replace()`-Aufruf aus ihrem Client-State.
   Steht der auf einem älteren Stand, macht schon der nächste Klick eine
   vorherige Änderung wieder rückgängig.

Ein Fix sollte die Schreibvorgänge feldgenau machen (nur den einen Typ
ändern statt die ganze Liste zu ersetzen) oder gegen einen veralteten
Stand absichern, statt blind alles zu überschreiben. Ein Repro-Test, der
zwei überlappende Schreibvorgänge simuliert, ist der natürliche Einstieg.
