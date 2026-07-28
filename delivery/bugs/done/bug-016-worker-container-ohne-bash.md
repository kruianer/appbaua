---
id: bug-016
app: appbaua
req: req-006
priority: high
created: 2026-07-28
---

# Observed

Der Worker schreibt Code, kann ihn aber nie selbst ausprobieren. In
praktisch jedem Verlaufseintrag steht derselbe Satz:

```
this container has no POSIX shell available (Bash tool fails on every
command), so I could not run `npm test`/`typecheck`/`lint` locally
```

Belegt am 27./28.07. über mehrere Repos und Task-Typen hinweg (AppBaua
22:30, 22:34, 22:45, 22:48, 22:55, 22:58; LivingGardenTwin 22:28, 17:26,
17:46, 17:50). Die Läufe gelten als `success`, weil der Code entstanden
ist — geprüft hat ihn aber niemand.

# Expected

Der Worker kann in seinem Container Shell-Befehle ausführen und damit die
Test-, Typecheck- und Lint-Befehle laufen lassen, die das Repo in
`delivery/stack.md` nennt. Ein Lauf, der seine eigene Arbeit nicht prüfen
kann, darf nicht die Regel sein.

# Steps

1. `docker exec appbaua-prod-worker-1 sh -lc 'command -v bash'` → nichts.
2. Beliebigen Worker-Lauf ansehen: die Zusammenfassung nennt fehlende
   Shell als Grund, warum nicht getestet wurde.

# Ursache

`Dockerfile.worker` baut auf `node:22-alpine`. Alpine bringt als `/bin/sh`
nur busybox mit und hat **kein bash**; die `apk add`-Zeile installiert
`git openssh chromium nss freetype harfbuzz ttf-freefont`, aber kein bash.

Claude Code führt jeden Befehl seines Bash-Tools über bash aus. Ohne bash
schlägt damit JEDER Shell-Aufruf des Workers fehl — nicht nur die
Test-Befehle, sondern alles, was er sonst noch prüfen wollte.

Nachgewiesen im laufenden prod-Container:

```
command -v bash  →  NEIN
/bin/sh          →  /bin/busybox
printenv SHELL   →  (leer)
```

Und die Gegenprobe, ebenfalls im laufenden Container:

```
apk add --no-cache bash && bash -c "echo bash-funktioniert"
→ bash-funktioniert
```

Das entwertet nebenbei das Test-Gate (req-019): Es prüft zwar im Worker
selbst, aber der Claude-Lauf davor konnte seine Arbeit nie vorab
verifizieren und hat entsprechend blind abgeliefert.

# Behoben am 2026-07-28

`bash` in die `apk add`-Zeile von `Dockerfile.worker` aufgenommen und
`ENV SHELL=/bin/bash` gesetzt (manche Werkzeuge lesen `SHELL`, um zu
entscheiden, was sie starten; Alpine lässt die Variable leer).
