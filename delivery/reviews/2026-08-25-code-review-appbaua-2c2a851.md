---
type: code-review
repo: AppBaua
commit: 2c2a851
date: 2026-08-25
---

# Code-Review: AppBaua (2c2a851)

Automatisch erstellt vom appbaua-Worker am 2026-08-25.

---
type: code-review
repo: appbaua
commit: 2c2a851
date: 2026-08-25
---

# Code-Review appbaua (Branch `dev`, Stand 2c2a851)

Bezug: [delivery/reviews/2026-08-18-code-review-appbaua-b1fd43f.md](delivery/reviews/2026-08-18-code-review-appbaua-b1fd43f.md). Seitdem sind fünf Commits gelandet, davon einer mit echter Code-Änderung: bug-019 ("Abgelaufene Anmeldung schiebt Pakete nach failed/") führt eine neue Auth-Expiry-Erkennung ein (`lib/auth-expired.ts`) und verdrahtet sie in `lib/execute-step.ts`/`lib/worker-loop.ts` — analog zur bestehenden Rate-Limit-Behandlung (req-029). Die restlichen vier Commits sind Berichte/Ideen ohne Code-Auswirkung. Ich habe alle zehn Vorbefunde erneut direkt am aktuellen Code gegengeprüft statt sie zu übernehmen, das Quality Gate live neu gefahren und den neuen bug-019-Code eigenständig gelesen.

**Quality Gate:** `NODE_ENV=development npm test` → **789/789 grün** (52 Testdateien, inkl. 5 neuer Tests für `auth-expired.ts`). `npm run typecheck` sauber. `npm run lint` weiterhin exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157) — bereits mehrfach als False Positives verifiziert. `npm audit`: weiterhin **4 High-Findings** (nanoid, postcss, sharp — alle drei nur transitiv über `next`, Fix ausschließlich per Breaking-Upgrade auf `next@16`), inhaltlich unverändert zum letzten Review.

---

## Kritisch

### 1. Middleware prüft nur "Cookie vorhanden", nicht "Session gültig" — fast alle API-Routen bleiben faktisch unauthentifiziert
**Unverändert seit 2026-08-04, jetzt viertes Review in Folge offen.** `middleware.ts:38` — `const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Der Kommentar direkt darüber verspricht eine zweite Prüfung ("A stale/forged cookie value still gets bounced at that second check"), die weiterhin nur in drei Dateien im gesamten `app/api`-Baum existiert (`app/api/auth/backup-codes`, `app/api/auth/invitations`, `app/api/auth/me`). `app/api/repos/*`, `app/api/worker-state/*`, `app/api/task-types/*` prüfen weiterhin nichts außer der Cookie-Existenz. Beide Umgebungen sind laut `delivery/devops.md` über je einen Cloudflare-Tunnel aus dem Internet erreichbar — ein geratener/leerer Cookie-Wert genügt weiterhin für Repo-Verwaltung, `POST /api/repos/[id]/appbaua` (pusht mit gespeichertem PAT in ein fremdes Repo) und Worker-Steuerung.

**Fix:** unverändert — die versprochene zweite Prüfung (`userIdForSession`/`currentUser`, 401 bei Ungültigkeit) tatsächlich in jede nicht-öffentliche Route bzw. einen gemeinsamen Wrapper einbauen.

### 2. Der Doku- und der Code-Review-/recurring-Task committen weiterhin fremde Änderungen
**Unverändert seit 2026-08-04.** Neu am Code verifiziert: der `idea`-Zweig (`lib/execute-step.ts:454`), der `security`-Zweig (Zeile 471) und jetzt auch der neue `auth-expired`-Zweig (Zeile 411) rufen korrekt `d.discardChanges(dir)` vor ihrem Push auf. Der `doc`-Zweig (Push Zeile 502, `"worker: Doku aktualisiert"`) und der `recurring`/Code-Review-Zweig (Push Zeile 572) tun das weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht, landet alles, was der Lauf sonst noch im Arbeitsverzeichnis anfasst, im selben Commit unter einer Message, die das nicht erkennen lässt.

**Fix:** unverändert — `discardChanges(dir)` vor `fileReport`/`push` in beiden Zweigen ergänzen (Doku-Zweig: nur `site/user-docs/` behalten).

### 3. Der abgelegte Bericht geht weiterhin unredigiert ins Repo
**Unverändert seit 2026-08-04.** `grep -n "redact" lib/execute-step.ts` liefert weiterhin **null Treffer**. `fileReport` schreibt `report`/`outcome.report` unverändert in die Datei; `redact()` läuft nach wie vor nur auf Log-Nachrichten und Git-Fehlerausgaben. Zitiert Claude in einem Review-/Security-/Doku-Lauf versehentlich ein Secret aus Tool-Output, landet es dauerhaft in der Git-Historie — betrifft genau die Art von Bericht, die auch dieses Dokument hier ist.

**Fix:** unverändert — `redact(report)` in `fileReport`, bevor der Inhalt geschrieben wird.

---

## Wichtig

### 4. Neu: `isAuthExpired`-Muster `/not authenticated/i` kann auf den eigenen Report-Text des Laufs statt auf einen echten Login-Fehler matchen
`lib/claude-runner.ts:406` bildet `tail` als `(res.stderr.trim() || finalResultText(res.stdout)).slice(-300)` — fällt der CLI-Prozess mit leerem `stderr`, aber non-zero Exit-Code und vorhandener finaler Antwort aus, wird der **Modelltext selbst** gescannt, nicht nur eine technische Fehlermeldung. `isAuthExpired` (`lib/auth-expired.ts:37-43`) matcht darin u. a. das generische Muster `/not authenticated/i`. Ein Review-/Security-Lauf, dessen letzte 300 Zeichen zufällig diese Formulierung enthalten (naheliegend gerade bei Berichten über Auth-Befunde wie Punkt 1 hier), würde dann fälschlich als abgelaufene Anmeldung statt als echter Fehler behandelt: Änderungen werden verworfen, das .md bleibt in `ready/`, und der Worker pausiert 6 Stunden mit einer irreführenden "Anmeldung abgelaufen"-Meldung im Verlauf — statt den tatsächlichen Fehler zu zeigen oder das .md nach `failed/` zu parken. Die übrigen vier Muster (`failed to authenticate`, `oauth session expired`, `session expired and could not be refreshed`, `invalid_grant`) sind spezifisch genug, um dieses Risiko nicht zu teilen; nur `not authenticated` ist ungewöhnlich breit für ein Muster, dessen Fehlklassifikation eine Fehlerursache verschleiert statt (wie bei Rate-Limits bewusst in Kauf genommen) nur ein "failed" vermeidet.

**Fix:** Muster präzisieren (z. B. `/\bnot authenticated\b.{0,20}(claude|api|cli)/i` oder ganz auf CLI-spezifische Formulierungen beschränken) oder nur gegen `res.stderr` matchen, nie gegen den Fallback auf `finalResultText(stdout)`.

### 5. Container laufen weiterhin in UTC, Zeitfenster werden lokal ausgewertet
**Unverändert seit 2026-08-04.** Kein `TZ` und kein `tzdata` in `docker-compose.yml`, `Dockerfile` oder `Dockerfile.worker`. Jedes in der Oberfläche eingestellte Zeitfenster läuft 1–2h verschoben zur deutschen Ortszeit.

### 6. "Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster
**Unverändert seit 2026-08-04.** `lib/worker-loop.ts:172` — `log.list(0, 500)`, keine echte Tages-Abfrage. Ein dauerhaft fehlschlagender Schritt kann das Fenster leerlaufen lassen, sodass ein wiederkehrender Task am selben Tag doppelt läuft.

### 7. `NODE_ENV=production` leckt weiterhin in Claudes eigene Kindprozesse
**Unverändert seit 2026-08-04.** `lib/claude-runner.ts` setzt weiterhin kein eigenes `NODE_ENV` (kein Treffer im Grep), während `lib/test-gate.ts` es korrekt für das offizielle Gate setzt. Führt Claude während einer Aufgabe selbst `npm install`/`npm test` aus, erbt der Kindprozess weiterhin `NODE_ENV=production`.

### 8. Lost-Update-Race in allen Repo-/Task-Typ-Mutationen
**Unverändert seit 2026-08-04.** `lib/repo-service.ts`/`lib/task-service.ts` folgen weiterhin durchgängig `list()` → mutieren → `replace()` ohne Sperre. Das im Repo bereits vorhandene Muster (`queueAppbauaStandard`, Promise-Kette in `lib/appbaua-standard.ts:436-440`) wird hier weiterhin nicht wiederverwendet.

### 9. Auth-Bootstrap: TOCTOU erlaubt einen zweiten Operator
**Unverändert seit 2026-08-04.** `lib/auth-bootstrap.ts:27-33` — `countUsers() > 0` und `createUser()` sind weiterhin nicht transaktional verbunden.

### 10. Doku in `devops.md`/`docker-compose.yml` zeigt auf einen Pfad, den der Deploy-Workflow nie liest
**Unverändert seit 2026-08-04.** `docker-compose.yml:4-5` und `delivery/devops.md:24,54` verweisen weiterhin auf `deploy/dev.env`/`deploy/prod.env`, während `.github/workflows/deploy.yml:41,44` und `delivery/deploy-setup.md` tatsächlich `$HOME/appbaua-env/{dev,prod}.env` lesen.

### 11. Unbegrenzte Prozessausgabe im Speicher, kein Memory-Limit auf dem Worker-Container
**Unverändert seit 2026-08-04.** `docker-compose.yml` setzt für keinen Service `mem_limit`/`mem_reservation`. `lib/workspace.ts` sammelt `stdout`/`stderr` weiterhin unbegrenzt für bis zu 60-minütige Claude-Läufe.

---

## Kleinere Punkte

- **`RunLog.tsx` `load()` hat weiterhin keine Fehlerbehandlung** (`components/RunLog.tsx:32-42`) — unverändert.
- **pg-store-Retention läuft weiterhin bei jedem Insert** (`lib/pg-store.ts`) — unverändert.
- **File-Store vergibt Log-IDs nach `clear()` neu**, Memory-Store bereits gefixt — unverändert.
- **`system-metrics`-`sampleCache` bleibt racy bei gleichzeitigem Polling** — unverändert.
- **Memory-Repo-Store backfillt `model` nicht** wie File-/Pg-Store — unverändert.
- **Backup-Code-Format weicht vom eigenen Kommentar und von der UI ab** (`lib/auth-recovery.ts:12-16` vs. `app/recovery/page.tsx:104`) — unverändert.
- **`npm audit`: weiterhin 4 High-Findings** — unverändert, nur per `next@16`-Major behebbar.
- **Kein Memory-/CPU-Limit auf `app`/`db`** — unverändert, niedrigere Priorität als Punkt 11.
- **`next lint` ist deprecated** (Next 15.5) — unverändert, Migration auf Flat Config vor Next 16 einplanen.

---

## Was gut ist

Der neue bug-019-Code ist sauber gebaut: `lib/auth-expired.ts` ist pure/text-only, gut kommentiert (erklärt bewusst, warum die Behandlung wie Rate-Limits läuft, aber mit langer Pause statt kurzer), und mit 5 gezielten Tests belegt, die genau die Grenzfälle prüfen, die eine Erkennung dieser Art braucht (positiv, negativ, "feuert nicht auf unrelated failure"). Die Verdrahtung in `execute-step.ts`/`worker-loop.ts` folgt konsequent dem bestehenden Rate-Limit-Muster (`PassResult.pauseUntil`/`pauseReason` statt zweier Parallelfelder) — kein Copy-Paste-Sonderpfad. Ansonsten unverändert solide: `pushFailed()` wird konsequent geprüft, `commitAndPush` rebased bei veraltetem Branch genau einmal nach (bug-017), `runTestGate` läuft unconditional vor jedem Move nach `done/`, SQL ist überall parametrisiert, WebAuthn-Ceremonies sind sorgfältig gebaut, Docker/Compose-Hygiene ist solide (kein Docker-Socket-/Host-Root-Mount, `init: true`, kein Secret-Literal im Repo).

---

**Empfehlung:** Befund 1 (Auth-Bypass) hat weiterhin uneingeschränkten Vorrang — viertes Review in Folge (2026-08-04, 08-11, 08-18, jetzt 08-25) mit identischem Befund, die App steht live über zwei Cloudflare-Tunnel im Internet. Neu ist Befund 4: ein schmales, aber reales Zeitfenster, in dem der neue bug-019-Code einen echten Fehler als abgelaufene Anmeldung fehlklassifizieren und 6 Stunden lang verschleiern kann — billig zu fixen (Muster einschränken oder nur gegen `stderr` matchen), sollte vor dem nächsten Zusammentreffen mit einem echten CLI-Fehlerfall erledigt werden. Danach 2 und 3 zusammen (je ein `discardChanges`/`redact`), da sie die Integrität genau der Berichte betreffen, die dieser Task-Typ selbst erzeugt.

---

**Zusammenfassung:** Seit dem letzten Review (b1fd43f, 2026-08-18) ist echter Code nur durch bug-019 dazugekommen — sauber umgesetzt, aber mit einer neuen, schmalen Fehlklassifikations-Lücke (Befund 4). Alle zehn Vorbefunde bleiben unverändert offen, allen voran Befund 1 (faktisch kein API-Auth-Schutz), jetzt im vierten Review in Folge unangetastet. Quality Gate ist grün (789/789 Tests, Typecheck sauber, Lint unverändert 5 False-Positives, `npm audit` unverändert 4 High-Findings ausschließlich transitiv über `next`). Ich habe nichts committet/gepusht.
