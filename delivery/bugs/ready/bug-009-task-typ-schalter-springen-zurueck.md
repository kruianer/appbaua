---
id: bug-009
app: appbaua
req: req-002
priority: high
created: 2026-07-26
---

# Observed

Task-Typ-Schalter springen zurück, sobald ich den Tab wechsle:

1. In der Task-Steuerung einzelne Typen aktivieren (z.B. `code-review`,
   `security`, `ideen`) — die Schalter gehen sichtbar an.
2. Auf den Aktivität-Tab wechseln.
3. Zurück auf die Task-Steuerung: die Typen sind wieder deaktiviert.

Es sieht aus, als würde die Einstellung nicht gespeichert. Zuvor auch
schon beobachtet als "Schalter sind Minuten später wieder aus" auf prod.

# Expected

Ein Schalter, den ich umlege, bleibt so — beim Tab-Wechsel, beim
Neuladen, und auch während der Worker weiterläuft. Bis ich ihn selbst
wieder ändere.

# Steps

1. Task-Steuerung öffnen, einen deaktivierten Typ einschalten.
2. Auf Aktivität wechseln.
3. Zurück auf Task-Steuerung — der Typ steht wieder auf inaktiv.

# Hinweis zur Ursache (Verdacht, bitte reproduce-first verifizieren)

Sehr wahrscheinlich ein reiner Frontend-Fehler, kein Persistenz-Problem:

`components/TaskControl.tsx` initialisiert seinen State aus einer Prop:

```ts
const [types, setTypes] = useState<TaskType[]>(initialTaskTypes);
```

`initialTaskTypes` kommt aus `app/page.tsx` (Server Component) und ist der
Stand **zum Zeitpunkt des Seitenaufrufs**. Beim Tab-Wechsel wird
`TaskControl` in `components/AppShell.tsx` (Zeile ~669) aus dem Baum
genommen und beim Zurückwechseln neu gemountet — dabei initialisiert
`useState` wieder mit derselben, inzwischen veralteten Prop. Die eigene
Änderung ist im Client-State verloren, obwohl sie serverseitig gespeichert
wurde.

Prüfen lohnt sich: liegt der geänderte Wert nach Schritt 1 tatsächlich in
der DB (`SELECT id, active FROM task_types`)? Wenn ja, ist es eindeutig
der Remount und nicht das Speichern.

Mögliche Richtungen für den Fix: den Stand beim Mounten (bzw. beim
Sichtbarwerden des Tabs) frisch vom Server holen, statt sich auf die
Initial-Prop zu verlassen — oder den Tab-Inhalt nicht aushängen, sondern
nur ausblenden, damit der State erhalten bleibt. Dasselbe Muster betrifft
potenziell auch die Repo-Liste (`initialRepos`) und den Hauptschalter
(`initialWorkerEnabled`) — bitte mitprüfen.
