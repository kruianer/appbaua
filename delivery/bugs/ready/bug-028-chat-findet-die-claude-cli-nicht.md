---
id: bug-028
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Im Chat kommt auf jede Nachricht die Antwort
**"Claude-Code-CLI nicht verfügbar"**. Der Chat ist damit vollständig
unbenutzbar — in jedem Repo, bei jeder Eingabe.

# Expected

Eine Nachricht im Chat erreicht Claude und wird beantwortet.

# Steps

1. Menüpunkt "Chat" öffnen, ein Repo wählen.
2. Irgendetwas schreiben und abschicken.
3. Als Antwort erscheint "Claude-Code-CLI nicht verfügbar".

# Hinweis zur Ursache

Gemessen auf dev, nicht geraten:

```
App-Container    (dort läuft der Chat):  which claude -> FEHLT
Worker-Container (dort läuft der Worker): which claude -> /usr/local/bin/claude
```

Die CLI wird in `Dockerfile.worker` installiert, nicht im `Dockerfile`
der App. Der Chat aus req-040 läuft aber im App-Container und ruft
dieselbe `runClaude`-Funktion auf — sie findet dort kein `claude` und
gibt die Meldung aus `lib/claude-runner.ts:507` zurück.

**Es fehlen zwei Dinge, nicht eines.** Ebenfalls gemessen im
App-Container:

```
git:                 /usr/bin/git          da
/work:               vorhanden             da
GITHUB_TOKEN:        gesetzt               da
HOME:                /home/nextjs
Anmeldung vorhanden: /home/nextjs/.claude/.credentials.json -> NEIN
```

Die CLI allein genügt also nicht: Claude authentifiziert sich über das
Abo, dessen Anmeldung im Worker-Container unter `/claude-home` als
Volume liegt (`claude-home`). Der App-Container hat dieses Volume
nicht eingehängt und sein `HOME` zeigt woanders hin. Selbst mit
installierter CLI käme als Nächstes ein Anmeldefehler.

Richtung für den Fix — bitte selbst abwägen:

Zwei Wege, und die Wahl ist eine Sicherheitsfrage, keine technische:

**A) Den App-Container ausstatten.** CLI installieren und das
`claude-home`-Volume einhängen. Einfach, aber: Der App-Container ist
der einzige Dienst, der aus dem Internet erreichbar ist. Er bekäme
damit die Abo-Anmeldung in seinen Lesebereich — genau die Art
Ausweitung, die bug-005 für den GITHUB_TOKEN rückgängig gemacht hat.

**B) Den Chat im Worker-Container ausführen.** Die App schickt die
Nachricht dorthin, wo CLI und Anmeldung schon sind, und bekommt die
Antwort zurück. Aufwendiger, aber die Abo-Anmeldung bleibt, wo sie
ist. Der `health-agent` ist das Vorbild: ein Dienst mit einer engen,
festen Schnittstelle, der nicht aus dem Internet erreichbar ist.

Zu bedenken bei B: Die Sitzungen aus req-040 (höchstens fünf, LRU,
acht Stunden Leerlauf) liegen heute im App-Container. Wo sie nach
einem Wechsel liegen, gehört mitentschieden.

Zu bedenken bei beiden: Der nächtliche Worker und der Chat teilen sich
dasselbe Abo (Constraint in req-040). Daran ändert sich nichts.

# Out of Scope

- Jede Verbesserung am Chat selbst (sichtbare Schritte, Abbrechen,
  Modellwahl). Hier geht es darum, dass er überhaupt läuft.
- Die Frage, ob der Chat ein eigenes Abo oder einen API-Schlüssel
  bekommen soll.
