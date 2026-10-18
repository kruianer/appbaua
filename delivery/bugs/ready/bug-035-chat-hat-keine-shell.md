---
id: bug-035
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Frage ich im Chat etwas, wofür Claude im Repo suchen oder zählen muss,
antwortet es:

> Das konnte ich nicht zählen, weil die Shell in dieser Sitzung nicht
> funktioniert. Jeder Bash-Aufruf bricht mit derselben Meldung ab:
> „No suitable shell found … ensure you have a valid shell installed
> and the SHELL environment variable set." Ohne Shell kann ich die
> Dateien weder auflisten noch durchsuchen, ich kann nur einzelne
> Dateien lesen, deren Pfad ich schon kenne.

Der Chat kann damit fast nichts, was über das Lesen einer bekannten
Datei hinausgeht: nicht suchen, nicht zählen, keine Tests starten,
keinen Befehl ausführen.

# Expected

Der Chat kann im Repo arbeiten wie der nächtliche Worker — suchen,
Dateien auflisten, Befehle und Tests ausführen.

# Steps

1. Im Chat fragen: "Zähl mal die Codezeilen und die Anzahl der Tests
   im Repo."
2. Die Antwort erklärt, dass keine Shell verfügbar ist, und schlägt
   vor, die Befehle selbst auszuführen.

# Hinweis zur Ursache

Gemessen im laufenden dev-Container, als Benutzer `nextjs`:

```
                 App-Container (Chat)   Worker-Container
SHELL            NICHT GESETZT          /bin/bash
/bin/bash        fehlt                  vorhanden
/bin/sh          -> busybox             (bash)
```

Weiter geprüft, was der Chat sonst vorfindet:

```
bash FEHLT · rg FEHLT
git · grep · find · sed · awk · node · npm · xargs · wc  — vorhanden
```

`Dockerfile.worker` installiert `bash` seit bug-016; das `Dockerfile`
der App nie, weil dort nie eine Shell gebraucht wurde. Mit bug-028 ist
der Chat in diesen Container gezogen — die CLI kam mit, die Umgebung
zum Arbeiten nicht.

Dasselbe Muster wie bug-016 und bug-024: Ein Lauf bringt die Zeit
nicht mit der Aufgabe zu, sondern mit dem Fehlen seiner Werkzeuge.

Richtung für den Fix — bitte selbst abwägen:

`bash` ins `Dockerfile` der App aufnehmen und `SHELL=/bin/bash` setzen.
Beides zusammen: Die Meldung nennt ausdrücklich beide Bedingungen, und
eine ohne die andere behebt es nicht.

**`rg` (ripgrep) gehört geprüft, nicht blind dazu.** Claude Code
benutzt es für Suchen, wenn es da ist, und weicht sonst auf `grep`
aus. Ob der Unterschied im Chat spürbar ist, zeigt sich erst mit
funktionierender Shell — und jedes Paket kostet Platz im Image.

Zu bedenken: Der Chat führt damit Befehle im selben Container aus, der
aus dem Internet erreichbar ist und `GITHUB_TOKEN` hält. Das war die
Abwägung in bug-028 und ändert sich hier nicht — es wird nur
greifbarer, weil jetzt wirklich Befehle laufen.

# Out of Scope

- Die Frage, ob der Chat besser im Worker-Container liefe. In bug-028
  entschieden; wird hier nicht neu aufgerollt.
- Anzeige und Rollverhalten des Chats (bug-033, bug-034).
