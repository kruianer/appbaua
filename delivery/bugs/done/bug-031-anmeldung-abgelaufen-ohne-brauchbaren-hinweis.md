---
id: bug-031
app: appbaua
req: req-040
priority: normal
created: 2026-10-18
---

# Observed

Im Chat kommt:

```
Fehler: Claude-Lauf fehlgeschlagen: Failed to authenticate.
API Error: 401 OAuth access token has expired. Re-authenticate to continue.
```

Die Meldung sagt, WAS kaputt ist, aber nicht, was ich dagegen tun soll.
Es steht nicht da, dass eine Anmeldung abgelaufen ist, nicht WELCHE
(dev und prod haben getrennte), und nicht, wo ich mich anmelden muss.

Ich musste nachsehen lassen, um herauszufinden: Die Anmeldung der
dev-Umgebung stammt vom 24. Juli, der Refresh-Token gilt etwa vier
Wochen. Sie ist seit rund zwei Monaten tot.

# Expected

Die App erkennt diesen Fall und sagt mir in einem Satz, was los ist —
und stellt mir den Befehl, der es behebt, **zum Kopieren** bereit. Ein
Klick, einfügen, fertig.

Bei mehreren nötigen Schritten steht jeder in einem eigenen Feld.

# Steps

1. Chat öffnen, eine Nachricht schicken.
2. Die Meldung erscheint als roher Fehlertext, ohne Hinweis auf die
   Ursache und ohne Weg zur Behebung.

# Hinweis zur Ursache

**Die Erkennung gibt es bereits, der Chat benutzt sie nur nicht.**
`lib/auth-expired.ts` (aus bug-019) erkennt genau diesen Fall; das
Muster `/failed to authenticate/i` greift auf die Meldung oben.
`lib/execute-step.ts:524` nutzt sie für den Worker, aber
`lib/chat-session-manager.ts` kennt sie nicht — dort wird nur auf
Rate-Limit geprüft, alles andere geht als roher Text durch.

**Der hinterlegte Befehl passt nicht.** `AUTH_EXPIRED_MESSAGE` nennt
`docker compose exec worker claude login`. Für den Chat ist das falsch:
Er läuft in der dev-Umgebung, und deren App-Container hat das Volume
nur lesend (bug-028). Anmelden muss man im dev-Worker:

```
docker exec -it appbaua-dev-worker-1 claude login
```

Je nach Umgebung ist es also ein anderer Container. Die Meldung sollte
nennen, welcher — sonst meldet man sich in der falschen an und der
Fehler bleibt.

Richtung für den Fix — bitte selbst abwägen:

**Das Kopierfeld gehört nicht nur hierher.** Dieselbe Lage gibt es beim
Worker (Verlauf, bug-019) und künftig bei jedem Fehler, der einen
Befehl auf dem Server verlangt. Ein Baustein "Befehl zum Kopieren" wäre
mehr wert als eine Sonderlösung im Chat.

**Woher die Umgebung kommt.** Welcher Container zu nennen ist, hängt
davon ab, ob dev oder prod läuft. `APP_ORIGIN` ist je Umgebung gesetzt
(docker-compose.yml) und unterscheidet sie bereits.

Zu bedenken: Das Kopieren in die Zwischenablage braucht in Browsern
einen sicheren Kontext (HTTPS) und eine Nutzergeste. Beides ist
gegeben, aber ein Rückfallweg gehört dazu — der Befehl muss auch
sichtbar und von Hand markierbar sein, falls das Kopieren scheitert.

# Out of Scope

- Die Anmeldung von der App aus erneuern. Sie ist ein interaktiver
  Vorgang mit dem Anthropic-Konto und gehört in die Hand des
  Betreibers.
- Eine Warnung, BEVOR eine Anmeldung abläuft.
- Eine Benachrichtigung außerhalb der App.
