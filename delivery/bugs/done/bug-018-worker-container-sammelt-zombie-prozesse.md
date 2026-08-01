---
id: bug-018
app: appbaua
req: req-006
priority: high
created: 2026-08-01
---

# Observed

Der Worker bringt seit Tagen keinen einzigen Schritt mehr durch. Jeder
Lauf endet sofort, für jedes Repo und jeden Task-Typ derselbe Fehler:

```
Repo vorbereiten fehlgeschlagen (Wegfara): Error: fetch failed:
error: cannot fork() for git-remote-https: Resource temporarily
unavailable
fatal: remote helper 'https' aborted session
```

Am 01.08. betraf das alle vier aktiven Repos in jedem Durchlauf (13:29,
13:34, 13:39 …). Der Container ist so weit dicht, dass nicht einmal mehr
`docker exec … sh` startet ("can't fork").

# Expected

Der Worker läuft über Tage durch, ohne sich selbst die Prozesstabelle zu
füllen. Ein Neustart darf nicht die Voraussetzung dafür sein, dass er
arbeitet.

# Steps

1. Worker mehrere Tage laufen lassen.
2. `docker exec appbaua-prod-worker-1 sh -c 'echo hi'` → "can't fork:
   Resource temporarily unavailable".

# Ursache

Zombie-Prozesse. Gezählt am 01.08. unter der Container-PID:

```
Kinder gesamt:  14062
davon Zombies:  14061
  13779  git
    118  esbuild
     68  chromium
     68  chrome_crashpad
     13  node
```

Der älteste lief zu dem Zeitpunkt seit über drei Tagen.

Der Container startet mit `CMD ["npm", "run", "worker"]`, PID 1 ist also
npm/Node. Ein normaler Prozess ist kein init: Er ruft kein `wait()` für
Kinder auf, die ihm vom Kernel zugeteilt werden. Genau das passiert hier
laufend — Claude Code startet git, Claude Code endet, das noch laufende
git wird an PID 1 vererbt. Dort bleibt jeder beendete Prozess als
Zombie-Eintrag stehen, bis die Tabelle voll ist und `fork()` scheitert.

Der Worker-Code selbst ist nicht schuld: `run()` in `lib/workspace.ts`
nutzt `spawn` mit `on("close")` und räumt seine DIREKTEN Kinder korrekt
ab. Die Zombies sind Enkelkinder, für die nur PID 1 zuständig ist.

Das erklärt auch, warum es sich als schleichende Instabilität zeigt:
Direkt nach einem Deploy läuft alles, und je länger der Container steht,
desto sicherer scheitert jeder Schritt.

# Behoben am 2026-08-01

`init: true` beim worker-Service in `docker-compose.yml`. Docker setzt
damit `docker-init` (tini) als PID 1, das genau eine Aufgabe hat: alles
abräumen, was es erbt. Dieselbe Wirkung wie `docker run --init`.

Der app-Service braucht es nicht — Next.js startet keine fremden
Kindprozesse.
