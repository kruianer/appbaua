---
id: bug-005
title: ensureSchema scheitert nach einem Fehler dauerhaft; App-Container mountet ganzes Host-Dateisystem
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-25
relates: req-006, req-009
quelle: Code-Review 2026-07-25 (Punkte 7 und 9)
---

# Beobachtetes Verhalten

Zwei unabhängige, je klein zu behebende Punkte:

1. **ensureSchema scheitert für immer** (`lib/pg-store.ts:59-70`): Das
   Schema-Setup-Promise wird gecacht. Rejected es einmal (DB beim Start
   noch nicht bereit, `schema.sql` kurz nicht lesbar), bleibt das
   rejected Promise für die gesamte Prozesslebensdauer stehen — jeder
   weitere DB-Zugriff schlägt danach fehl, bis der Container neu startet.

2. **Ganzes Host-Dateisystem gemountet** (`docker-compose.yml:56`):
   `/:/host/root:ro` wird nur für ein `statfs` (freier Speicherplatz,
   `lib/system-metrics-host.ts:222`) gemountet. Damit liegen u.a.
   `~/appbaua-env/*.env` mit GITHUB_TOKEN und DB-Passwort im Lesebereich
   des einzigen internetzugewandten Prozesses. `statfs` funktioniert auf
   jedem Pfad desselben Dateisystems.

# Erwartetes Verhalten

1. Ein einmal fehlgeschlagenes Schema-Setup wird beim nächsten Zugriff
   erneut versucht (nicht dauerhaft gecacht).
2. Der freie Speicherplatz wird ermittelt, ohne das gesamte
   Host-Dateisystem in den App-Container zu mounten.

# Vorgeschlagene Lösung (aus dem Review)

1. Bei Rejection `schemaReady = null` setzen, damit der nächste Aufruf es
   erneut versucht.
2. Statt `/` einen engen Pfad desselben Dateisystems mounten (z.B.
   `/var/lib/docker:/host/root:ro`) — `statfs` liefert denselben Wert bei
   drastisch kleinerer Angriffsfläche.

# Akzeptanzkriterien

- [ ] Given das Schema-Setup schlägt einmal fehl (DB kurz nicht bereit),
  when kurz darauf erneut auf die DB zugegriffen wird, then wird das
  Schema-Setup neu versucht und der Zugriff gelingt (kein dauerhaftes
  Scheitern bis zum Neustart).
- [ ] Given der prod-Stack läuft, when man den App-Container betrachtet,
  then ist NICHT das gesamte Host-Root (`/`) gemountet, aber die Kachel
  „Freier Speicherplatz" zeigt weiterhin einen korrekten Wert.

# Out of Scope

- Weitere Härtung der Container (nur diese zwei Punkte).
