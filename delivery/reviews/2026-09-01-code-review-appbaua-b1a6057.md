---
type: code-review
repo: AppBaua
commit: b1a6057
date: 2026-09-01
---

# Code-Review: AppBaua (b1a6057)

Automatisch erstellt vom appbaua-Worker am 2026-09-01.

Die Review ist durch. Quality Gate lief live, alle Vorbefunde habe ich am aktuellen Code gegengeprüft, der neue req-032–035-Code (rund 12.000 Zeilen) ist eigenständig gelesen. Hier der vollständige Bericht:

---
type: code-review
repo: appbaua
commit: b1a6057
date: 2026-09-01
---

# Code-Review appbaua (Branch `dev`, Stand b1a6057)

Bezug: [delivery/reviews/2026-08-25-code-review-appbaua-2c2a851.md](delivery/reviews/2026-08-25-code-review-appbaua-2c2a851.md). Seitdem sind neun Commits gelandet, davon fünf mit echter Code-Änderung: die komplette neue Area **App-Überwachung** (req-032 Zustandsübersicht/Neustart, req-033 Telegram, req-034 Herzschlag + PHP-Ausfallwächter, req-035 KI-Loganalyse) sowie bug-020 (Netzwerk-Retry in `lib/workspace.ts`). Das sind ~12.400 neue Zeilen in 94 Dateien — der größte Zuwachs seit dem Aufsetzen des Projekts, und mit `health-agent`, Docker-Socket, Telegram-Bot und einem fremd gehosteten PHP-Dienst auch der mit der größten Angriffsfläche. Ich habe den neuen Code eigenständig gelesen, alle elf Vorbefunde direkt am aktuellen Code gegengeprüft (statt sie zu übernehmen) und das Quality Gate live neu gefahren.

**Quality Gate:** `NODE_ENV=test npx vitest run` → **1076/1076 grün**, 9 übersprungen (71 Testdateien; die 9 sind die PHP-Verhaltenstests des Wächters, siehe Befund 8). `npm run typecheck` sauber. `npm run lint` weiterhin exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157) — mehrfach als False Positives verifiziert. `npm audit`: unverändert **4 High-Findings** (nanoid, postcss, sharp — alle drei nur transitiv über `next`, Fix nur per Breaking-Upgrade auf `next@16`).

---

## Kritisch

### 1. Middleware prüft nur „Cookie vorhanden" — und hinter dieser Lücke stehen jetzt Neustart, KI-Kosten und der Stummschalter der Überwachung
**Unverändert seit 2026-08-04, jetzt fünftes Review in Folge — aber die Auswirkung ist mit req-032/033/035 eine andere geworden.** `middleware.ts:38` prüft weiterhin nur `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Die im Kommentar darüber versprochene zweite Prüfung existiert nach wie vor nur in drei Dateien des gesamten `app/api`-Baums (`auth/backup-codes`, `auth/invitations`, `auth/me`); auch `app/page.tsx` validiert die Sitzung nicht, sondern lädt direkt die Listen.

Neu dazugekommen sind vier Routen ohne jede eigene Prüfung:

- `app/api/health/restart/route.ts:7` — **startet einen laufenden Container neu.** `restartAppContainer` prüft sorgfältig, dass der Container zur genannten App gehört (`lib/health-service.ts:183`) — aber nicht, wer fragt. Ein `POST` mit `Cookie: <session>=x` und `{"repoId":"…","container":"lgt-prod-app"}` startet den prod-Container einer fremden App neu. req-032 hält ausdrücklich fest, dass der Neustart „echte laufende Systeme, auch prod-Umgebungen fremder Apps" trifft und deshalb nur auf ausdrücklichen Klick passieren soll; die Telegram-Seite desselben Features (`lib/telegram-commands.ts`) verlangt dafür sogar eine Rückfrage mit Bestätigung. Über HTTP genügt ein beliebiger Cookie-Wert.
- `app/api/health/analyze/route.ts:10` — **gibt Geld der fremden App aus.** Jeder Aufruf liest bis zu 5 Container-Logs und schickt bis zu 12.000 Zeichen mit `max_tokens: 4096` an den KI-Anbieter der App, mit deren Schlüssel. Bewusst an keinem Schalter der Einstellungen (der Klick *ist* die Entscheidung) und ohne Rate-Limit — die einzige Bremse ist `if (analyzing) return` im Client (`components/HealthOverview.tsx:210`). In einer Schleife aufgerufen ist das eine unbegrenzte Rechnung auf fremde Kosten.
- `app/api/health/settings/route.ts:13` — schaltet jede Prüfart, die Telegram-Meldungen und die Loganalyse ab. Wer sie stumm schaltet, hebelt genau die Alarmierung aus, die req-032/033 aufgebaut haben.
- `app/api/repos/[id]/monitored/route.ts:7` — dasselbe eine Ebene höher.

Dazu unverändert `app/api/repos/*` (inkl. `POST /api/repos/[id]/appbaua`, das mit dem gespeicherten PAT in ein fremdes Repo pusht), `app/api/worker-state/*`, `app/api/task-types/*`. Beide Umgebungen stehen laut `delivery/devops.md` über je einen Cloudflare-Tunnel im Internet.

**Fix:** unverändert — die versprochene zweite Prüfung (`userIdForSession`/`currentUser`, 401 bei Ungültigkeit) in einen gemeinsamen Wrapper legen und über jede nicht-öffentliche Route ziehen. Bei fünf Wiederholungen und dieser Rechteausweitung ist das kein Backlog-Punkt mehr.

### 2. Der Doku- und der Code-Review-/recurring-Task committen weiterhin fremde Änderungen
**Unverändert seit 2026-08-04.** Am aktuellen Code nachgeprüft: der `idea`-Zweig (`lib/execute-step.ts:454`), der `security`-Zweig (471) und der `auth-expired`-Zweig (411/425) rufen korrekt `d.discardChanges(dir)` vor ihrem Push. Der `doc`-Zweig (Push `lib/execute-step.ts:502`, `"worker: Doku aktualisiert"`) und der `recurring`-Zweig (`fileReport` 566, Push 572) tun das weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht, landet alles, was der Lauf sonst im Arbeitsverzeichnis angefasst hat, im selben Commit unter einer Message, die das nicht erkennen lässt.

**Fix:** unverändert — `discardChanges(dir)` vor `fileReport`/`push` in beiden Zweigen (Doku-Zweig: nur `site/user-docs/` behalten).

### 3. Der abgelegte Bericht geht weiterhin unredigiert ins Repo
**Unverändert seit 2026-08-04.** `grep -c redact lib/execute-step.ts` → weiterhin **0**. `fileReport` (`lib/execute-step.ts:693`) schreibt `report` unverändert in die Datei. Bemerkenswert: die neuen Module machen es an jeder vergleichbaren Stelle richtig — `lib/telegram-service.ts:229`, `lib/heartbeat-service.ts:178`, `lib/log-analysis-service.ts:88,197` redigieren konsequent, letzteres sogar mit dem gerade benutzten API-Schlüssel als `extraSecret`. Nur der Weg, auf dem *dieses Dokument hier* im Repo landet, tut es nicht.

**Fix:** unverändert — `redact(report)` in `fileReport`, bevor geschrieben wird.

---

## Wichtig

### 4. NEU: Der `health-agent` vertraut seinem Netz vollständig — kein Geheimnis, keine Herkunftsprüfung
`agent/index.ts` ist der einzige Prozess mit dem Docker-Socket, bewusst von der App getrennt (bug-005-Argument, sauber begründet). Der Server nimmt aber **jede** Anfrage entgegen, die ihn erreicht: es gibt keinen gemeinsamen Schlüssel, keinen Header-Vergleich, keine Herkunftsprüfung. Damit kann jeder Prozess im Compose-Netz

- `GET /containers/<id>/env?name=POSTGRES_PASSWORD` — **jede benannte Umgebungsvariable jedes Containers des Rechners lesen.** Der Kommentar (`lib/docker.ts:52-55`) begründet die Beschränkung auf *eine* Variable damit, dass alles andere „ein Auszug aller Geheimnisse aller Apps" wäre — durch Namensraten ist es genau das, nur langsamer;
- `POST /containers/<id>/restart` — jeden Container neu starten, auch die, die zu keiner überwachten App gehören;
- `GET /containers/<id>/logs` — die Logs jedes Containers lesen.

Im Compose-Netz stehen `app` (internetzugewandt, siehe Befund 1), `worker` (führt Claude Code mit Netzzugang aus), `db` und `cloudflared`. Die Trennung von App und Socket ist damit weniger wert als beabsichtigt: sie kostet einen Angreifer einen Zwischenschritt, keine Berechtigung.

**Fix:** ein `HEALTH_AGENT_TOKEN` in beiden Diensten (Compose-Variable, wie die anderen Geheimnisse), Vergleich mit `timingSafeEqual` als erstes im Handler. Zehn Zeilen, und die Grenze steht wirklich da, wo der Kommentar sie beschreibt.

### 5. NEU: `psql` in der Erlaubnisliste ist faktisch beliebige Befehlsausführung
`lib/docker.ts:35-44` prüft ausschließlich `cmd[0]` gegen `ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"]`; die restlichen Argumente gehen ungeprüft an die Engine (`agent/index.ts:77` prüft dasselbe noch einmal — dieselbe unvollständige Prüfung, zweimal). `psql -c` akzeptiert laut PostgreSQL-Doku „either a command string … or a single backslash command" — `psql -c '\! …'` startet also einen Shell-Befehl im Zielcontainer, und `psql -c 'COPY … FROM PROGRAM …'` tut dasselbe im Server. Damit ist der Satz in `agent/index.ts:16-17` („Insbesondere gibt es … keinen Weg, einen beliebigen Befehl zu starten") und in `lib/docker.ts:31-33` („alles andere wäre eine beliebige Befehlsausführung als root auf dem Host, und dafür gibt es hier keinen Grund") nicht zutreffend — der Grund ist versehentlich mitgeliefert.

Ausnutzbar ist das heute nur mit Zugang zum Compose-Netz (Befund 4), nicht über die App: die beiden Aufrufer bauen ihre Argumente selbst (`lib/health-checks.ts:149,293`), und die Werte aus der `health.md` sind durch die Parser-Regexe auf `[a-z0-9_.]` beschränkt, sodass sich dort weder ein Leerzeichen noch ein `\` einschmuggeln lässt. Es ist also kein offenes Loch, aber die einzige Verteidigungslinie dieses Dienstes ist deutlich dünner als dokumentiert.

**Fix:** die ganze Argumentform prüfen statt nur `cmd[0]` — für `pg_isready` und `psql` sind es genau zwei feste Muster (`-U <user> -d <db>` bzw. zusätzlich `-tAc <select>`), inklusive Verbot von `-c` mit führendem Backslash.

### 6. NEU: Die Web-Prüfung wertet „konnte nicht geprüft werden" als Rot — und löst damit falsche Telegram-Alarme aus
`lib/health-checks.ts:26-29` formuliert den Grundsatz der Datei: „Rot heißt geprüft und kaputt. Konnte eine Prüfung gar nicht laufen …, ist das unbekannt." `containerCheck`, `databaseCheck`, `zigbeeCheck` und `aiCheck` halten sich daran. `webCheck` (197-200) nicht: **jeder** Fehler aus `fetchImpl` — DNS-Ausfall im App-Container, ein `TypeError: Failed to parse URL` aus einer schief geschriebenen Zeile der `health.md`, ein Proxy-Fehler — setzt `failed = true` und damit `status: "fail"`.

Die Folge steht in req-033: `planAlerts` meldet nach `ALERT_AFTER_FAILS = 2` aufeinanderfolgenden Fehlschlägen. Bei Vorgabe-Intervall 5 Minuten heißt das: zehn Minuten Namensauflösungs-Problem im App-Container → **eine Telegram-Nachricht pro überwachter App**, mitten in der Nacht, über Apps, denen nichts fehlt. Genau die Falschmeldung, gegen die der Rest der Datei so sorgfältig gebaut ist.

**Fix:** in `webCheck` zwischen „Antwort mit unerwartetem Status" (= `fail`, das ist der eigentliche Zweck der Prüfung) und „kein Ergebnis erhalten" unterscheiden. Ein `TypeError` beim URL-Parsen gehört auf `unconfigured`, ein Netzfehler des eigenen Containers auf `unknown` — zumindest dann, wenn ALLE Web-Ziele gleichzeitig scheitern, denn das ist ein Befund über den eigenen Container und nicht über die Apps.

### 7. NEU: Die neuen Geheimnisse sollen laut Doku nach `deploy/*.env` — einen Pfad, den der Deploy nie liest
Eskalation des Vorbefunds 10, der bisher nur eine Doku-Ungenauigkeit war. `delivery/devops.md` weist den Nutzer jetzt an drei Stellen an, echte Zugangsdaten in `deploy/dev.env` bzw. `deploy/prod.env` einzutragen: `APP_ORIGIN` (Zeile 24), `CLOUDFLARE_TUNNEL_TOKEN` (54), **`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` (80)** und **`WATCHDOG_URL`/`WATCHDOG_TOKEN` (117)**. `.github/workflows/deploy.yml:50,53` liest ausschließlich `$HOME/appbaua-env/{dev,prod}.env`.

Wer der Anleitung von req-033/req-034 wörtlich folgt, trägt die Werte an der falschen Stelle ein — und bekommt keine Fehlermeldung, sondern Stille: `readTelegramConfig` (`lib/telegram.ts:36`) und `readHeartbeatConfig` (`lib/heartbeat.ts:57`) geben ohne die Variablen `null` zurück, `startTelegramMonitor`/`startHeartbeat` starten wortlos nicht. Die Überwachung läuft, meldet aber nie — und dass sie nie meldet, merkt man erst, wenn man es gebraucht hätte. Dazu committet der Nutzer ein `deploy/`-Verzeichnis mit Klartext-Geheimnissen, das in `.gitignore` gar nicht steht (geprüft).

**Fix:** `delivery/devops.md` und den Kopf der `docker-compose.yml` durchgehend auf `~/appbaua-env/<env>.env` umstellen (oder den Workflow beide Pfade lesen lassen). Zusätzlich: `startTelegramMonitor()`/`startHeartbeat()` geben bereits `boolean` zurück — `instrumentation.ts:314,316` verwirft das. Ein Verlaufseintrag „Telegram nicht eingerichtet" beim Start würde diesen Fehlgriff sofort sichtbar machen.

### 8. NEU: Der PHP-Ausfallwächter wird faktisch ungetestet ausgeliefert
`watchdog/watchdog.test.ts:45` — `describe.skipIf(!PHP)`. Hier im Container: `php` fehlt, **9 von 14 Tests übersprungen**; übrig bleiben 5 Quelltext-Prüfungen (`toContain("hash_equals(")` u. ä.). Der Deploy-Workflow installiert PHP „best effort" (`.github/workflows/deploy.yml`, `continue-on-error: true` plus `|| true` — und ohne vorheriges `apt-get update`, was auf einem länger laufenden self-hosted Runner der übliche Grund für ein scheiterndes `apt-get install` ist). Ob die Tests im CI je gelaufen sind, lässt sich am Repo nicht ablesen; ausgeschaltet sind sie jedenfalls lautlos.

Betroffen ist die gesamte Entscheidungslogik des Wächters: Token-Prüfung, 403 ohne Kennung, Alarm nach Frist, genau eine Nachricht pro Ausfall, Entwarnung. `delivery/stack.md` ist hier eindeutig („Jedes Requirement wird mit automatisierten Tests geliefert … Eine Änderung ohne Test für ihr Verhalten ist nicht fertig"), und req-034 ist ausgerechnet das Requirement, das greifen soll, wenn sonst nichts mehr funktioniert.

**Fix:** PHP im Test-Job verbindlich installieren (`apt-get update` davor, ohne `continue-on-error`) — oder, dauerhafter, die reinen Entscheidungsfunktionen (`watchdog_on_beat`, `watchdog_on_check`, `watchdog_token_ok`) als portierte Referenzimplementierung in TypeScript mitführen und beide gegen dieselbe Tabelle fahren. Mindestens aber: der Lauf muss sichtbar melden, dass er die Hälfte des Wächters nicht geprüft hat.

### 9. Container laufen weiterhin in UTC, Zeitfenster werden lokal ausgewertet
**Unverändert seit 2026-08-04, jetzt mit neuer Wirkung.** Kein `TZ` und kein `tzdata` in `docker-compose.yml`, `Dockerfile`, `Dockerfile.worker` oder dem neuen `Dockerfile.agent` (geprüft). Neu betroffen: `lib/telegram-commands.ts:28` liest `process.env.TZ || "Europe/Berlin"` und fällt damit auf die richtige Zone zurück — der PHP-Wächter setzt seine Zone ohnehin selbst (`watchdog.php:44`). Die Zeitfenster der Task-Typen laufen dagegen weiterhin 1–2 h gegen die deutsche Ortszeit verschoben. Ein `TZ: Europe/Berlin` in der Compose-Datei räumt beides zusammen auf.

### 10. „Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster
**Unverändert seit 2026-08-04.** `lib/worker-loop.ts:172` — `log.list(0, 500)`, keine echte Tages-Abfrage. Neu verschärft: die Überwachung schreibt jetzt selbst in denselben Verlauf — jede Log-Analyse (`lib/log-analysis-service.ts:82`, Label „Log-Analyse", bei aktivem `logAnalysisOnFailure` potenziell mehrfach täglich pro App), jeder gescheiterte Telegram-Versand, jeder ausgebliebene Herzschlag. Das Fenster füllt sich damit schneller als vor req-032, und ein wiederkehrender Task kann am selben Tag doppelt laufen.

### 11. `NODE_ENV=production` leckt weiterhin in Claudes eigene Kindprozesse
**Unverändert seit 2026-08-04.** `grep NODE_ENV lib/claude-runner.ts` → weiterhin kein Treffer, während `lib/test-gate.ts` es für das offizielle Gate korrekt setzt. Führt Claude während einer Aufgabe selbst `npm install`/`npm test` aus, erbt der Kindprozess `NODE_ENV=production` — und fährt damit eine halbe Test-Suite gegen die falsche Umgebung.

### 12. Lost-Update-Race in allen Repo-/Task-Typ-Mutationen — jetzt auch in den Health-Blobs
**Unverändert seit 2026-08-04, mit neuen Fällen.** `lib/repo-service.ts` und `lib/task-service.ts` folgen weiterhin durchgängig `list()` → mutieren → `replace()` ohne Sperre; der neue `toggleRepoMonitored` (`lib/repo-service.ts:81-87`) reiht sich exakt in dieses Muster ein. Dasselbe im Health-Speicher: `record()` (`lib/log-analysis-service.ts:79-80`) liest alle Analysen, ergänzt eine und schreibt alles zurück — eine Analyse auf Knopfdruck parallel zur regelmäßigen Runde verliert eine der beiden. `setResults`/`setAlertState` überschreiben ebenfalls den ganzen Blob. Das im Repo vorhandene Muster (Promise-Kette wie in `lib/appbaua-standard.ts:436-440`) wird an keiner dieser Stellen wiederverwendet.

### 13. Auth-Bootstrap: TOCTOU erlaubt einen zweiten Operator
**Unverändert seit 2026-08-04.** `lib/auth-bootstrap.ts:29-38` — `countUsers() > 0` und `createUser()` sind weiterhin nicht transaktional verbunden.

### 14. Unbegrenzte Prozessausgabe im Speicher, kein Memory-Limit auf irgendeinem Container
**Unverändert seit 2026-08-04, jetzt mit einem Container mehr.** `docker-compose.yml` setzt für keinen Dienst `mem_limit`/`mem_reservation` (geprüft), inklusive des neuen `health-agent`. `lib/workspace.ts:96-118` sammelt `stdout`/`stderr` weiterhin unbegrenzt für bis zu 60-minütige Claude-Läufe.

---

## Kleinere Punkte

**Neu, aus req-032–035:**

- **`runRound` listet die Container je Repo statt je Runde.** `lib/health-checks.ts:499-505` — der Kommentar sagt „Einmal auflisten und an alle Prüfungen dieser Runde weiterreichen", der Aufruf steht aber innerhalb der `for (const repo …)`-Schleife. Bei N überwachten Apps sind das N Aufrufe an den Agenten pro Runde statt einem.
- **Entwarnung ohne vorherige Meldung.** `lib/telegram-service.ts:281-285`: bei abgeschalteten Meldungen wird der Zustand inklusive `alerted: true` fortgeschrieben (bewusst, gegen die „Lawine" beim Einschalten). Wird Telegram danach eingeschaltet und die App erholt sich, ist die erste Nachricht überhaupt ein „🟢 wieder in Ordnung" zu einem Ausfall, von dem der Nutzer nie erfahren hat.
- **Die `/neustart`-Rückfrage verfällt nie.** `lib/telegram-monitor.ts:208` hält `pending` unbefristet im Speicher der Schleife, und `CONFIRM_WORDS` (`lib/telegram-commands.ts:70`) enthält das blanke „ja". Ein „ja" Stunden später — in ganz anderem Zusammenhang — startet den Container. Ein Verfall nach wenigen Minuten wäre eine Zeile.
- **Prompt-Injection aus fremden Logs.** Die Zusammenfassung der KI geht unverändert in die Telegram-Nachricht (`lib/telegram-service.ts:278`) und auf die Karte. Wer in eine überwachte App Text hineinschreiben kann, der geloggt wird, schreibt indirekt an der Meldung mit. Folgenlos, solange nichts daraufhin gehandelt wird (req-035 schließt das ausdrücklich aus) — erwähnenswert, weil dieser Ausschluss die einzige Absicherung ist.
- **`WATCHDOG_TOKEN` fehlt in `SECRET_ENV_VARS`** (`lib/redact.ts:124`). Er reist im Header, taucht also in Fehlermeldungen normalerweise nicht auf — aber `TELEGRAM_BOT_TOKEN` steht aus demselben Grund dort und der Wächter-Token ist gleich viel wert.
- **Der Wächter schreibt seinen Zustand ohne Sperre.** `watchdog.php:320-333`: lesen → (bis zu 15 s Telegram) → schreiben. Läuft `check.php` genau in dem Moment, in dem ein Herzschlag ankommt, überschreibt es dessen `lastBeatAt` mit dem alten Wert. Fenster klein, Folge harmlos (eine verspätete Entwarnung), aber ein `flock` auf die Zustandsdatei wäre billiger als die Analyse dieses Falls im Ernstfall.
- **Als URL-Cronjob trägt `check.php` die Kennung in der Query** (`watchdog.php:358`) — und damit in die Zugriffslogs des Hosters. Der Header-Weg existiert bereits; das README sollte ihn für den Cronjob empfehlen.
- **Kommentare zum `health-agent` stimmen nicht mehr.** „genau vier Aufrufe" in `docker-compose.yml:150` und `Dockerfile.agent:3` (es sind fünf, `logs` kam mit req-035 dazu); „kein Netzwerk nach außen" in `Dockerfile.agent:19` — der Dienst hängt am normalen Compose-Netz und hat vollen Ausgang. „Bewusst winzig" ist ebenfalls großzügig: `npm ci` zieht `next`, `react` und `playwright-core` in genau den Container, der den Docker-Socket hält.

**Aus früheren Reviews, unverändert:**

- `RunLog.tsx` `load()` weiterhin ohne Fehlerbehandlung (`components/RunLog.tsx:32-42`) — `HealthOverview.tsx:163-174` macht es an derselben Stelle richtig.
- pg-store-Retention läuft weiterhin bei jedem Insert.
- File-Store vergibt Log-IDs nach `clear()` neu.
- `system-metrics`-`sampleCache` bleibt racy bei gleichzeitigem Polling.
- Memory-Repo-Store-Backfill: **teilweise behoben** — `withDefaults` (`lib/store.ts:26-32`) deckt jetzt `model` und `monitored` ab, greift im Memory-Store aber weiterhin nur beim Anlegen, nicht in `replace()`.
- Backup-Code-Format weicht vom eigenen Kommentar und von der UI ab (`lib/auth-recovery.ts:12-16` vs. `app/recovery/page.tsx:104`).
- `npm audit`: 4 High-Findings, nur per `next@16`-Major behebbar.
- `next lint` ist deprecated (Next 15.5) — Migration auf Flat Config vor Next 16 einplanen.

---

## Was gut ist

Der req-032–035-Block ist trotz seiner Größe bemerkenswert diszipliniert gebaut. Die Trennung „reine Logik ↔ Naht nach draußen" ist konsequent durchgezogen (`health.ts`/`health-checks.ts`, `telegram-alerts.ts`/`telegram-service.ts`, `heartbeat.ts`/`heartbeat-service.ts`, `log-analysis.ts`/`log-analysis-service.ts`) — deshalb sind 1076 Tests ohne laufendes Docker, ohne Telegram und ohne KI-Anbieter möglich. Die Unterscheidung zwischen `fail`, `unknown` und `unconfigured` ist die richtige Antwort auf die Frage, die ein Überwachungssystem falsch beantwortet, wenn es sie sich nicht stellt — und sie wird (bis auf Befund 6) überall durchgehalten. `planAlerts` löst die Doppelzählung nicht fällig gewesener Prüfungen über den `checkedAt`-Vergleich statt über einen Zeitpuffer; das ist die einfachere und die richtige Lösung. Der Umgang mit den Geheimnissen fremder Apps ist sorgfältig: die `health.md` nennt nur den **Namen** der Schlüsselvariable, appbaua hält den Wert nirgends vor, `scrubLogs` (`lib/log-analysis.ts:135`) läuft vor jedem Abfluss an einen fremden Anbieter und legt sieben Muster über `redact`, und die Fehlermeldung eines KI-Aufrufs wird mit dem gerade benutzten Schlüssel als `extraSecret` redigiert. Dass der Docker-Socket in einen eigenen Dienst gewandert ist statt in den internetzugewandten Container, ist genau die Entscheidung, die bug-005 nahelegt (Befund 4 und 5 kritisieren die Ausführung, nicht den Entwurf). Der PHP-Wächter ist bewusst klein gehalten, benutzt `hash_equals`, schreibt seinen Zustand atomar über `rename` und nimmt eine abgewiesene Anfrage ausdrücklich **nicht** als Herzschlag — die Falle, in die eine naive Umsetzung tappt. Der bug-020-Fix folgt der Vorgabe des Bug-Berichts exakt: eine Retry-Schicht (`runRemote`), nicht ein zweiter Mechanismus neben bug-017, mit einer eng gefassten Liste transienter Fehler und einer eigenen Wall-Clock-Grenze nur für die `ls-remote`-Sonden, weil git selbst keinen Connect-Timeout kennt. Ansonsten unverändert solide: `pushFailed()` wird konsequent geprüft, `runTestGate` läuft unconditional vor jedem Move nach `done/`, SQL ist überall parametrisiert, WebAuthn ist sorgfältig gebaut.

---

**Empfehlung:** Befund 1 hat weiterhin uneingeschränkten Vorrang und ist nicht mehr derselbe Befund wie im August — hinter derselben Lücke stehen jetzt ein Neustart-Knopf für fremde prod-Container, eine unbegrenzte Rechnung beim KI-Anbieter fremder Apps und der Stummschalter der ganzen Überwachung. Fünf Reviews in Folge (08-04, 08-11, 08-18, 08-25, heute) mit demselben unangetasteten Kern. Danach 7 (falscher env-Pfad), denn er ist eine Doku-Zeile und entscheidet gerade darüber, ob req-033/034 im Betrieb überhaupt etwas tun — ein Wächter, der wegen eines Pfads stumm bleibt, ist teurer als gar keiner. Dann 6 (Falschalarme aus der Web-Prüfung), weil Fehlalarme die Glaubwürdigkeit der Meldungen schneller aufbrauchen als jeder verpasste Ausfall. Dann 4 und 5 zusammen — ein gemeinsames Geheimnis plus eine vollständige Argumentprüfung, beides an einem Nachmittag zu machen. 8 gehört vor den nächsten Eingriff am Wächter erledigt, sonst fällt eine Regression dort erst im Ernstfall auf.

**Zusammenfassung:** Seit dem letzten Review (2c2a851, 2026-08-25) ist mit req-032 bis req-035 eine ganze neue Area dazugekommen — handwerklich der bislang beste Code des Projekts, mit sauberen Nähten, ehrlichen Zuständen und sorgfältigem Umgang mit fremden Geheimnissen. Fünf neue Befunde betreffen ausnahmslos die Ränder dieses Blocks: den ungeschützten Agenten, die zu weite `psql`-Erlaubnis, die Web-Prüfung, die „nicht geprüft" mit „kaputt" verwechselt, die Doku, die neue Geheimnisse an einen toten Pfad schickt, und den PHP-Wächter, dessen Tests lautlos übersprungen werden. Alle elf Vorbefunde bleiben offen; Befund 1 ist durch die neuen Routen von einem Auth-Problem zu einem Fernsteuerungsproblem geworden. Quality Gate grün (1076/1076 Tests + 9 übersprungen, Typecheck sauber, Lint unverändert 5 False Positives, `npm audit` unverändert 4 High-Findings ausschließlich transitiv über `next`). Ich habe nichts committet und nichts gepusht.
