---
type: code-review
repo: AppBaua
commit: 8478b52
date: 2026-08-11
---

# Code-Review: AppBaua (8478b52)

Automatisch erstellt vom appbaua-Worker am 2026-08-11.

Die Review ist abgeschlossen. Kernbefund: Seit dem letzten Code-Review (651f29a, 2026-08-04) hat sich am Code **nichts** verändert — `git diff 651f29a..HEAD` außerhalb von `delivery/reviews/`/`delivery/security/` ist leer, die beiden einzigen Commits seitdem sind reine Berichts-Dateien. Ich habe das Quality Gate trotzdem live neu gefahren (782/782 Tests grün, Typecheck sauber, Lint unverändert 5 False-Positive-Warnungen) und die kritischsten Vorbefunde direkt im Code neu verifiziert statt sie nur zu übernehmen. Neu: `npm audit` zeigt jetzt einen vierten High-Finding (`nanoid`, transitiv, ungenutzt im eigenen Code).

Hier der vollständige Bericht:

```markdown
# Code-Review appbaua (Branch `dev`, Stand 8478b52)

Bezug: [delivery/reviews/2026-08-04-code-review-appbaua-651f29a.md](delivery/reviews/2026-08-04-code-review-appbaua-651f29a.md). Seitdem sind genau zwei Commits gelandet, beide reine Berichts-Ablagen (der Code-Review-Bericht selbst und ein Security-Bericht) — **kein einziger Commit hat Code, Config oder Doku außerhalb von `delivery/reviews/` bzw. `delivery/security/` verändert**. Verifiziert per `git diff 651f29a..HEAD -- . ':!delivery/reviews' ':!delivery/security'`: leer. Damit sind alle zehn Befunde und alle Kleineren Punkte aus dem letzten Review unverändert offen; ich habe die relevantesten davon (Middleware, `discardChanges`, `redact`, `TZ`, `log.list`-Fenster, `NODE_ENV` in `claude-runner.ts`, Memory-Limits) direkt am aktuellen Code neu gegengeprüft statt sie nur zu übernehmen — Ergebnis identisch zum letzten Bericht. Neu vs. letztem Review: **kein** neuer Code-Befund, aber ein zusätzlicher `npm audit`-Treffer (nanoid, s.u.).

**Quality Gate:** `NODE_ENV=development npm test` → **782/782 grün** (51 Testdateien). `npm run typecheck` sauber. `npm run lint` meldet weiterhin exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157) — bereits im letzten Review als False Positives verifiziert (fehlende Deps sind `useState`-Setter aus der Elternkomponente, deren Identität React stabil hält). `npm audit` meldet jetzt **4** statt 3 High-Findings: die bekannten PostCSS-/sharp-Lücken (weiterhin nur über `next@15.5.21` transitiv, Fix nur per Breaking-Upgrade auf `next@16`) **plus neu `nanoid <3.3.17`** (GHSA-2v37-7h3g-55p8, Endlosschleife bei generatorseitig übergebener Size `0`) — ebenfalls rein transitiv (`next → postcss@8.4.31 → nanoid@3.3.16`), im eigenen Code kein einziger `nanoid`-Import (geprüft per Grep über `lib/app/components`), also kein erreichbarer Angriffspfad.

---

## Kritisch

### 1. Middleware prüft nur "Cookie vorhanden", nicht "Session gültig" — fast alle API-Routen bleiben faktisch unauthentifiziert
**Unverändert seit 2026-08-04.** `middleware.ts:38` — `const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Der Kommentar direkt darüber (`middleware.ts:7-12`) behauptet, ein gefälschter Cookie-Wert werde "at that second check" abgefangen — diese zweite Prüfung existiert aber weiterhin nur in den Auth-eigenen Routen. Neu direkt am Code verifiziert: `app/api/repos/route.ts`, `app/api/repos/[id]/route.ts`, `app/api/repos/[id]/appbaua/route.ts`, `app/api/worker-state/route.ts` und `app/api/task-types/*` enthalten **keinen** Treffer für `userIdForSession`/`currentUser` (Grep über alle genannten Dateien: null Treffer). Beide Umgebungen sind laut `delivery/devops.md` über je einen Cloudflare Tunnel aus dem Internet erreichbar — mit einem geratenen/leeren Cookie-Wert bleiben Repo-Verwaltung, `POST /api/repos/[id]/appbaua` (pusht den appbaua-Standard mit gespeichertem PAT in ein fremdes Repo) und die Worker-Steuerung offen.

**Fix:** unverändert — die im Middleware-Kommentar versprochene zweite Prüfung tatsächlich in jede nicht-öffentliche Route (oder einen gemeinsamen Wrapper) einbauen, der `userIdForSession` aufruft und bei ungültiger Session 401 liefert.

### 2. Der Code-Review- und der Doku-Task committen weiterhin fremde Änderungen
**Unverändert seit 2026-08-04.** Neu am Code verifiziert (`lib/execute-step.ts`): der `doc`-Zweig (Zeile 464-470) ruft vor `push("worker: Doku aktualisiert")` kein `discardChanges` auf; der `recurring`/Code-Review-Zweig (Zeile 531-539) ebenso nicht vor seinem `push(commitMsg)`. Im Gegensatz dazu rufen `idea` (Zeile 421) und `security` (Zeile 438) es korrekt auf. Da `commitAndPush` intern `git add -A` macht, landet alles, was der Lauf sonst noch im Arbeitsverzeichnis anfasst, im selben Commit — unter einer Message, die das nicht erkennen lässt.

**Fix:** unverändert — `discardChanges(dir)` vor `fileReport`/`push` in beiden Zweigen ergänzen (Doku-Zweig: nur `site/user-docs/` behalten).

### 3. Der abgelegte Bericht geht weiterhin ungeredigiert ins Repo
**Unverändert seit 2026-08-04.** Neu verifiziert: `fileReport` (`lib/execute-step.ts:660-685`) reicht `report` unverändert an `reportContent` (Zeile 679) weiter — kein `redact()`-Aufruf im gesamten Pfad. `redact()` läuft weiterhin nur auf Log-Nachrichten und Git-Fehlerausgaben, nicht auf den Berichtsinhalt selbst. Zitiert Claude in einem Review-/Security-/Doku-Lauf versehentlich ein Secret aus Tool-Output, landet es dauerhaft in der Git-Historie.

**Fix:** unverändert — `redact(report)` in `fileReport`, bevor der Inhalt geschrieben wird.

---

## Wichtig

### 4. Container laufen weiterhin in UTC, Zeitfenster werden lokal ausgewertet
**Unverändert seit 2026-08-04.** Neu geprüft: kein `TZ` und kein `tzdata` in `docker-compose.yml`, `Dockerfile` oder `Dockerfile.worker` (Grep: kein Treffer). Jedes in der Oberfläche eingestellte Zeitfenster läuft 1–2h verschoben zur deutschen Ortszeit.

### 5. "Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster
**Unverändert seit 2026-08-04.** `lib/worker-loop.ts:160` — `log.list(0, 500)`, keine echte Tages-Abfrage. Ein dauerhaft fehlschlagender Schritt kann das Fenster leerlaufen lassen, sodass ein wiederkehrender Task am selben Tag doppelt läuft.

### 6. `NODE_ENV=production` leckt weiterhin in Claudes eigene Kindprozesse
**Unverändert seit 2026-08-04.** Neu geprüft: `lib/claude-runner.ts` setzt weiterhin kein eigenes `NODE_ENV` (Grep: kein Treffer), während `lib/test-gate.ts` `DEV_TEST_ENV` korrekt für Install und Testlauf des offiziellen Gates setzt. Führt Claude während einer Aufgabe selbst `npm install`/`npm test` außerhalb des offiziellen Gate-Pfads aus, erbt der Kindprozess weiterhin `NODE_ENV=production` vom Worker-Container.

**Fix:** unverändert — denselben `DEV_TEST_ENV`-Ansatz auch für den `spawn`-Aufruf in `claude-runner.ts` anwenden.

### 7. Lost-Update-Race in allen Repo-/Task-Typ-Mutationen
**Unverändert seit 2026-08-04.** `lib/repo-service.ts`/`lib/task-service.ts` folgen weiterhin `list()` → mutieren → `replace()` ohne Sperre, bei allen drei Backends reproduzierbar. Das im Repo bereits vorhandene Muster (`queueAppbauaStandard`, `lib/appbaua-standard.ts:436-440`, Promise-Kette) wird hier weiterhin nicht wiederverwendet.

### 8. Auth-Bootstrap: TOCTOU erlaubt einen zweiten Operator
**Unverändert seit 2026-08-04.** `lib/auth-bootstrap.ts:27-33` — `countUsers() > 0` und `createUser()` sind weiterhin nicht transaktional verbunden, kein Unique-Index auf `is_operator` in `schema.sql`.

### 9. Doku in `devops.md`/`docker-compose.yml` zeigt auf einen Pfad, den der Deploy-Workflow nie liest
**Unverändert seit 2026-08-04.** `docker-compose.yml:4-5` und `delivery/devops.md` verweisen weiterhin auf `deploy/dev.env`/`deploy/prod.env`, während `.github/workflows/deploy.yml` und `delivery/deploy-setup.md` `$HOME/appbaua-env/{dev,prod}.env` lesen. `deploy/` ist weiterhin weder in `.gitignore` noch `.dockerignore` ausgeschlossen.

### 10. Unbegrenzte Prozessausgabe im Speicher, kein Memory-Limit auf dem Worker-Container
**Unverändert seit 2026-08-04.** Neu geprüft: `docker-compose.yml` setzt für keinen Service (`worker`, `app`, `db`) `mem_limit`/`mem_reservation` (Grep: kein Treffer). `lib/workspace.ts` sammelt `stdout`/`stderr` weiterhin unbegrenzt für bis zu 60-minütige Claude-Läufe.

---

## Kleinere Punkte

- **`RunLog.tsx` `load()` hat weiterhin keine Fehlerbehandlung** (`components/RunLog.tsx:32-42`) — unverändert seit 2026-08-04.
- **pg-store-Retention läuft weiterhin bei jedem Insert** (`lib/pg-store.ts:258-268`) — unverändert.
- **File-Store vergibt Log-IDs nach `clear()` neu** (`lib/run-log-store.ts:81-83`), Memory-Store bereits gefixt — unverändert.
- **`system-metrics`-`sampleCache` bleibt racy bei gleichzeitigem Polling** (`lib/system-metrics-host.ts:58`) — unverändert.
- **Memory-Repo-Store backfillt `model` nicht** wie File-/Pg-Store — unverändert.
- **Backup-Code-Format weicht vom eigenen Kommentar und von der UI ab** (`lib/auth-recovery.ts:12-16` vs. `app/recovery/page.tsx:104`) — unverändert.
- **`npm audit`: jetzt 4 statt 3 High-Findings** — neu hinzugekommen `nanoid <3.3.17` (transitiv über `postcss`, kein eigener Import, kein erreichbarer Pfad); PostCSS/sharp weiterhin nur per `next@16`-Major-Upgrade behebbar.
- **Kein Memory-/CPU-Limit auf `app`/`db`** — unverändert, niedrigere Priorität als Punkt 10.
- **`next lint` ist deprecated** (Next 15.5) — unverändert, Migration auf Flat Config vor Next 16 einplanen.

---

## Was gut ist

Unverändert solide, erneut stichprobenartig gegengeprüft: `pushFailed()` wird konsequent geprüft, `commitAndPush` rebased bei veraltetem Branch genau einmal nach (bug-017). `runTestGate` läuft unconditional vor jedem Move nach `done/` für alle datei-getriebenen Schritte — bestätigt durch den heutigen Testlauf (782/782 grün). Der Worker-Loop bleibt gegen Abstürze robust (Fehlerbehandlung auf jeder Ebene, globale `unhandledRejection`/`uncaughtException`-Handler). SQL ist überall parametrisiert. Die WebAuthn-Ceremonies sind sorgfältig gebaut (Origin/rpId-Prüfung, Single-Use-Challenges, generische Fehler gegen Enumeration, korrekte Cookie-Flags). Docker/Compose-Hygiene ist solide: kein Docker-Socket-/Host-Root-Mount, `init: true` für den Worker vorhanden, `CLOUDFLARE_TUNNEL_TOKEN` nirgends als Literalwert im Repo, dev/prod sauber über Compose-Projektnamen getrennt.

---

**Empfehlung:** Unverändert seit dem letzten Review — Befund 1 (Auth-Bypass) hat weiterhin Vorrang vor allem anderen, da die App über zwei Cloudflare-Tunnel live im Internet steht und der faktische Zustand "kein Login" ist. Danach 2 und 3 zusammen (je ein `discardChanges`/`redact`), da sie die Integrität genau der Berichte betreffen, die dieses Review-Dokument selbst erzeugt. Befund 9 bleibt eine Ein-Zeilen-Korrektur mit stillem Deploy-Skip-Risiko. Diese drei Befunde stehen jetzt seit mindestens zwei aufeinanderfolgenden Reviews unangetastet im Repo — sie sollten vor jeder weiteren Feature-Arbeit eingeplant werden, nicht als Dauerzustand im Bericht mitgeschleppt werden.
```

**Zusammenfassung:** Der Code ist seit dem letzten Review byte-identisch (nur zwei reine Berichts-Commits dazwischen). Alle zehn Befunde von 2026-08-04 sind unverändert offen, besonders kritisch weiterhin Befund 1 (faktisch kein API-Auth-Schutz trotz Middleware-Kommentar, der das Gegenteil behauptet). Quality Gate ist grün (782/782 Tests), einzige Neuigkeit ist ein zusätzlicher, aber ungefährlicher `npm audit`-Treffer (nanoid, transitiv, ungenutzt). Ich habe nichts committet/gepusht — das Ablegen der Datei überlasse ich wie vereinbart dir.
