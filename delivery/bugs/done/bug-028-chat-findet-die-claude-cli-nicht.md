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

# Fix

**Entschieden: Der App-Container wird ausgestattet.** Die CLI wird auch
im `Dockerfile` der App installiert, und das `claude-home`-Volume wird
dort eingehängt. Der Chat bleibt, wo er ist.

Der Betreiber hat das abgewogen: Die App steht hinter einem
Cloudflare-Tunnel und einem Passkey, und er ist ihr einziger Nutzer.

Zwei Auflagen, die zur Entscheidung gehören:

1. **Das Volume wird nur lesend eingehängt** (`claude-home:/claude-home:ro`).
   Der App-Container muss die Anmeldung lesen; schreiben muss nur
   `claude login`, und das läuft im Worker-Container. Ein Fehler im
   Chat kann die Anmeldung so nicht beschädigen.
2. **`HOME` des App-Containers muss auf `/claude-home` zeigen**, sonst
   findet die CLI die Anmeldung nicht — heute steht es auf
   `/home/nextjs`.

Zu bedenken — was im Schadensfall erreichbar wäre: Mit CLI und
Anmeldung im selben Container läuft Claude Code dort mit Datei- und
Bash-Zugriff, und der App-Container hält `GITHUB_TOKEN` mit
Schreibrecht auf alle Repos des Betreibers. Der mögliche Schaden ist
also Code in den Repos, nicht nur verbrauchte Tokens. Das ändert die
Entscheidung nicht, gehört aber in die Akten: Wird der Zugang je für
weitere Personen geöffnet, ist sie neu zu treffen.

Zum Vergleich der verworfene Weg: **Den Chat im Worker-Container
ausführen**, wo CLI und Anmeldung schon sind — Vorbild `health-agent`,
ein Dienst mit enger Schnittstelle ohne Erreichbarkeit aus dem
Internet. Aufwendiger; verworfen, weil der Zugang hinter Passkey liegt.

Unverändert gilt: Der nächtliche Worker und der Chat teilen sich
dasselbe Abo (Constraint in req-040).

# Out of Scope

- Jede Verbesserung am Chat selbst (sichtbare Schritte, Abbrechen,
  Modellwahl). Hier geht es darum, dass er überhaupt läuft.
- Die Frage, ob der Chat ein eigenes Abo oder einen API-Schlüssel
  bekommen soll.

# Nachtrag (bug-037)

**Auflage 1 oben ist zurückgenommen:** `claude-home` ist im
App-Container seit bug-037 wieder schreibbar eingehängt, nicht mehr
`:ro`.

Grund: Die Annahme war falsch, dass nur `claude login` die
Anmeldedatei schreibt. Ein OAuth-Zugangstoken ist kurzlebig (Stunden)
und wird bei **jedem** normalen Lauf per Refresh-Token erneuert, wobei
Claude Code die Datei neu schreibt — nicht lesend möglich. Mit `:ro`
verlangte der Chat deshalb praktisch täglich eine neue Anmeldung.

Das Risiko, das die Auflage eindämmen sollte — ein beschädigter Chat
legt auch den Worker lahm, weil beide dieselbe Anmeldung teilen —,
besteht unverändert fort. Es bleibt aber begrenzt: dev und prod
benutzen bereits getrennte Volumes (`appbaua-dev_claude-home` und
`appbaua-prod_claude-home`, je eigenes Compose-Projekt), ein
beschädigter Chat auf dev trifft den prod-Worker also so oder so
nicht.
