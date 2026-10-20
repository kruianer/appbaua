---
id: bug-032
app: appbaua
req: req-040
priority: high
created: 2026-10-18
---

# Observed

Auf **jede** Nachricht im Chat kommt:

> Die vorherige Sitzung ist nicht mehr bekannt — das Gespräch beginnt neu.

Nicht nur nach einem Neustart, sondern jedes Mal. Claude hat damit nie
Kenntnis vom bisherigen Gespräch — jede Frage steht für sich, und
Rückbezüge ("und was ist mit dem anderen Bug?") gehen ins Leere.

# Expected

Eine Sitzung überlebt von einer Nachricht zur nächsten. Die Meldung
erscheint nur dann, wenn eine Sitzung wirklich verloren ging — etwa
nach einem Neustart.

# Steps

1. Im Chat etwas schreiben, Antwort abwarten.
2. Eine zweite Nachricht schreiben.
3. Die Meldung erscheint erneut, obwohl nichts neu gestartet wurde.

# Hinweis zur Ursache

Gemessen im laufenden dev-Container:

```
/claude-home      RW=false      (nur lesend)
touch /claude-home/.claude/projects/test
  -> Read-only file system
ls /claude-home/.claude/projects/
  -> -app, -tmp, -work-github-com-kruianer-appbaua
     (alte Einträge; KEIN -chat-work-...)
```

**Die Ursache ist eine Auflage aus bug-028.** Dort wurde festgelegt,
das `claude-home`-Volume nur lesend einzuhängen, damit ein Fehler im
Chat die Anmeldung nicht beschädigt. Dabei wurde übersehen: Claude legt
seine Sitzungen im selben Verzeichnis ab — unter
`$HOME/.claude/projects/`, benannt nach dem Arbeitsverzeichnis.

Nur lesend bedeutet also: Keine Sitzung kann je geschrieben werden.
bug-029 greift dann bei jeder Nachricht, verwirft die Kennung und
beginnt neu — die Logik arbeitet korrekt, sie bekommt nur nie eine
Sitzung zu sehen, die es noch gibt.

Das Arbeitsverzeichnis selbst ist in Ordnung: `CHAT_WORKDIR` zeigt auf
`/chat-work`, ein eigenes Volume (zweiter Teil von bug-029).

Richtung für den Fix — bitte selbst abwägen:

Die Absicht hinter `:ro` war richtig und sollte erhalten bleiben: Die
Anmeldedatei soll der Chat nicht verändern können. Nur darf das nicht
das ganze Verzeichnis sperren.

Denkbar wäre, die Sitzungen woandershin zu legen als die Anmeldung —
etwa in das bereits vorhandene `/chat-work`-Volume. Wie das geht, ist
zu prüfen: Claude leitet den Ort aus `$HOME` ab, und `$HOME` zeigt
derzeit auf `/claude-home`.

Zu bedenken: Hängt man das Volume einfach schreibbar ein, ist die
Auflage aus bug-028 hinfällig. Das wäre vertretbar, sollte aber
bewusst entschieden und dort vermerkt werden — nicht stillschweigend
rückgängig gemacht.

# Out of Scope

- Sichtbare Zwischenschritte im Chat (was Claude gerade tut). Eigenes
  Thema.
- Die Frage, ob Gespräche nach acht Stunden Leerlauf enden (req-040,
  so gewollt).
