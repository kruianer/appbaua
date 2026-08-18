---
type: code-review
repo: AppBaua
commit: b1fd43f
date: 2026-08-18
---

# Code-Review: AppBaua (b1fd43f)

Automatisch erstellt vom appbaua-Worker am 2026-08-18.

# Code-Review: appbaua (Branch `dev`, Stand b1fd43f, 2026-08-18)

```markdown
---
type: code-review
repo: appbaua
commit: b1fd43f
date: 2026-08-18
---

# Code-Review appbaua (Branch `dev`, Stand b1fd43f)

Bezug: [delivery/reviews/2026-08-11-code-review-appbaua-8478b52.md](delivery/reviews/2026-08-11-code-review-appbaua-8478b52.md). Seitdem sind drei Commits gelandet — ein Security-Bericht, ein Code-Review-Bericht und eine neue Idee (`sicherheits-befund-verlauf.md`). Verifiziert per `git diff 8478b52..HEAD --stat`: **kein einziger** verändert Code, Config oder Doku außerhalb von `delivery/reviews/`, `delivery/security/` bzw. `delivery/idea/`. Damit ist das hier die **dritte** Review in Folge (2026-08-04, 2026-08-11, jetzt 2026-08-18) mit identischem Code. Ich habe das Quality Gate live neu gefahren und alle zehn Vorbefunde erneut direkt am aktuellen Code gegengeprüft statt sie nur zu übernehmen — Ergebnis unverändert zu beiden Vorgängern.

**Quality Gate:** `NODE_ENV=development npm test` → **782/782 grün** (51 Testdateien). `npm run typecheck` sauber. `npm run lint` weiterhin exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157) — bereits zweimal als False Positives verifiziert (fehlende Deps sind `useState`-Setter der Elternkomponente, deren Identität React stabil hält). `npm audit`: weiterhin **4 High-Findings** (nanoid, transitiv über `postcss`, kein eigener Import; PostCSS jetzt mit vier statt zuvor knapper aufgeführten GHSA-IDs — XSS im Stringify-Output sowie drei Varianten eines Path-Traversal-über-`sourceMappingURL`-Lecks; sharp/libvips-CVEs) — alle drei Pakete ausschließlich transitiv über `next`, Fix nur per Breaking-Upgrade auf `next@16`.

---

## Kritisch

### 1. Middleware prüft nur "Cookie vorhanden", nicht "Session gültig" — fast alle API-Routen bleiben faktisch unauthentifiziert
**Unverändert seit 2026-08-04, jetzt drittes Review in Folge offen.** `middleware.ts:38` — `const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Der Kommentar direkt darüber (`middleware.ts:7-12`) verspricht, ein gefälschter Cookie-Wert werde "at that second check" abgefangen — diese zweite Prüfung existiert weiterhin nur in den Auth-eigenen Routen. Neu direkt am Code verifiziert: `app/api/repos/*`, `app/api/worker-state/*`, `app/api/task-types/*` enthalten weiterhin **keinen** Treffer für `userIdForSession`/`currentUser` (nur 3 Dateien im gesamten `app/api`-Baum rufen die Prüfung überhaupt auf). Beide Umgebungen sind laut `delivery/devops.md` über je einen Cloudflare Tunnel aus dem Internet erreichbar — mit einem geratenen/leeren Cookie-Wert bleiben Repo-Verwaltung, `POST /api/repos/[id]/appbaua` (pusht den appbaua-Standard mit gespeichertem PAT in ein fremdes Repo) und die Worker-Steuerung offen.

**Fix:** unverändert — die im Middleware-Kommentar versprochene zweite Prüfung tatsächlich in jede nicht-öffentliche Route (oder einen gemeinsamen Wrapper) einbauen, der `userIdForSession` aufruft und bei ungültiger Session 401 liefert.

### 2. Der Code-Review- und der Doku-Task committen weiterhin fremde Änderungen
**Unverändert seit 2026-08-04.** Neu am Code verifiziert (`lib/execute-step.ts`): der `idea`-Zweig (Zeile 421) und der `security`-Zweig (Zeile 438) rufen vor ihrem `push(...)` korrekt `d.discardChanges(dir)` auf. Der `doc`-Zweig (Push bei Zeile 469, `"worker: Doku aktualisiert"`) und der `recurring`/Code-Review-Zweig (Push bei Zeile 539) tun das weiterhin nicht. Da `commitAndPush` intern `git add -A` macht, landet alles, was der Lauf sonst noch im Arbeitsverzeichnis anfasst, im selben Commit — unter einer Message, die das nicht erkennen lässt.

**Fix:** unverändert — `discardChanges(dir)` vor `fileReport`/`push` in beiden Zweigen ergänzen (Doku-Zweig: nur `site/user-docs/` behalten).

### 3. Der abgelegte Bericht geht weiterhin ungeredigiert ins Repo
**Unverändert seit 2026-08-04.** Neu verifiziert: `grep -n "redact" lib/execute-step.ts` liefert **null Treffer** — `fileReport` (Zeile 660ff.) schreibt `report`/`outcome.report` unverändert in die Datei. `redact()` läuft weiterhin nur auf Log-Nachrichten und Git-Fehlerausgaben, nicht auf den Berichtsinhalt selbst. Zitiert Claude in einem Review-/Security-/Doku-Lauf versehentlich ein Secret aus Tool-Output, landet es dauerhaft in der Git-Historie — betrifft genau die Art von Bericht, die auch dieses Dokument hier ist.

**Fix:** unverändert — `redact(report)` in `fileReport`, bevor der Inhalt geschrieben wird.

---

## Wichtig

### 4. Container laufen weiterhin in UTC, Zeitfenster werden lokal ausgewertet
**Unverändert seit 2026-08-04.** Neu geprüft: kein `TZ` und kein `tzdata` in `docker-compose.yml`, `Dockerfile` oder `Dockerfile.worker` (Grep: kein Treffer). Jedes in der Oberfläche eingestellte Zeitfenster läuft 1–2h verschoben zur deutschen Ortszeit.

### 5. "Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster
**Unverändert seit 2026-08-04.** `lib/worker-loop.ts:160` — `log.list(0, 500)`, keine echte Tages-Abfrage. Ein dauerhaft fehlschlagender Schritt kann das Fenster leerlaufen lassen, sodass ein wiederkehrender Task am selben Tag doppelt läuft.

### 6. `NODE_ENV=production` leckt weiterhin in Claudes eigene Kindprozesse
**Unverändert seit 2026-08-04.** Neu geprüft: `lib/claude-runner.ts` setzt weiterhin kein eigenes `NODE_ENV` (Grep über die Datei: kein Treffer), während `lib/test-gate.ts` `NODE_ENV: "development"` korrekt für Install und Testlauf des offiziellen Gates setzt (Zeile 56). Führt Claude während einer Aufgabe selbst `npm install`/`npm test` außerhalb des offiziellen Gate-Pfads aus, erbt der Kindprozess weiterhin `NODE_ENV=production` vom Worker-Container.

**Fix:** unverändert — denselben Ansatz auch für den `spawn`-Aufruf in `claude-runner.ts` anwenden.

### 7. Lost-Update-Race in allen Repo-/Task-Typ-Mutationen
**Unverändert seit 2026-08-04.** Neu geprüft: `lib/repo-service.ts`/`lib/task-service.ts` folgen weiterhin durchgängig `list()` → mutieren → `replace()` ohne Sperre (alle Mutations-Funktionen in beiden Dateien betroffen). Das im Repo bereits vorhandene Muster (`queueAppbauaStandard`, Promise-Kette in `lib/appbaua-standard.ts`) wird hier weiterhin nicht wiederverwendet.

### 8. Auth-Bootstrap: TOCTOU erlaubt einen zweiten Operator
**Unverändert seit 2026-08-04.** `lib/auth-bootstrap.ts:27-33` — `countUsers() > 0` und `createUser()` sind weiterhin nicht transaktional verbunden.

### 9. Doku in `devops.md`/`docker-compose.yml` zeigt auf einen Pfad, den der Deploy-Workflow nie liest
**Unverändert seit 2026-08-04.** Neu verifiziert: `docker-compose.yml:4-5` und `delivery/devops.md:24,54` verweisen weiterhin auf `deploy/dev.env`/`deploy/prod.env`, während `.github/workflows/deploy.yml:41,44` und `delivery/deploy-setup.md` tatsächlich `$HOME/appbaua-env/{dev,prod}.env` lesen — zwei unterschiedliche Pfade, konsistent falsch dokumentiert an zwei Stellen.

### 10. Unbegrenzte Prozessausgabe im Speicher, kein Memory-Limit auf dem Worker-Container
**Unverändert seit 2026-08-04.** Neu geprüft: `docker-compose.yml` setzt für keinen Service (`worker`, `app`, `db`) `mem_limit`/`mem_reservation` (Grep: kein Treffer). `lib/workspace.ts` sammelt `stdout`/`stderr` weiterhin unbegrenzt für bis zu 60-minütige Claude-Läufe.

---

## Kleinere Punkte

- **`RunLog.tsx` `load()` hat weiterhin keine Fehlerbehandlung** (`components/RunLog.tsx:32-42`) — unverändert.
- **pg-store-Retention läuft weiterhin bei jedem Insert** (`lib/pg-store.ts`) — unverändert.
- **File-Store vergibt Log-IDs nach `clear()` neu**, Memory-Store bereits gefixt — unverändert.
- **`system-metrics`-`sampleCache` bleibt racy bei gleichzeitigem Polling** — unverändert.
- **Memory-Repo-Store backfillt `model` nicht** wie File-/Pg-Store — unverändert.
- **Backup-Code-Format weicht vom eigenen Kommentar und von der UI ab** (`lib/auth-recovery.ts:12-16` vs. `app/recovery/page.tsx:104`) — unverändert.
- **`npm audit`: weiterhin 4 High-Findings**, aber `postcss` weist jetzt 4 statt weniger einzeln benannter GHSA-IDs aus (XSS + drei Path-Traversal-Varianten über `sourceMappingURL`) — inhaltlich dieselbe Ursache (nur per `next@16`-Major behebbar), keine neue Angriffsfläche im eigenen Code.
- **Kein Memory-/CPU-Limit auf `app`/`db`** — unverändert, niedrigere Priorität als Punkt 10.
- **`next lint` ist deprecated** (Next 15.5) — unverändert, Migration auf Flat Config vor Next 16 einplanen.

---

## Was gut ist

Unverändert solide, erneut stichprobenartig gegengeprüft: `pushFailed()` wird konsequent geprüft, `commitAndPush` rebased bei veraltetem Branch genau einmal nach (bug-017). `runTestGate` läuft unconditional vor jedem Move nach `done/` für alle datei-getriebenen Schritte — bestätigt durch den heutigen Testlauf (782/782 grün, 51 Testdateien). Der Worker-Loop bleibt gegen Abstürze robust. SQL ist überall parametrisiert. Die WebAuthn-Ceremonies sind sorgfältig gebaut (Origin/rpId-Prüfung, Single-Use-Challenges, generische Fehler gegen Enumeration, korrekte Cookie-Flags). Docker/Compose-Hygiene ist solide: kein Docker-Socket-/Host-Root-Mount, `init: true` für den Worker vorhanden, kein Secret-Literal im Repo, dev/prod sauber über Compose-Projektnamen getrennt.

---

**Empfehlung:** Befund 1 (Auth-Bypass) hat weiterhin uneingeschränkten Vorrang — die App steht über zwei Cloudflare-Tunnel live im Internet, der faktische Zustand ist "kein Login" für fast die gesamte API. Das ist jetzt das **dritte** Review in Folge, das diesen Befund unverändert meldet (2026-08-04, 2026-08-11, 2026-08-18); er sollte vor jeder weiteren Feature-Arbeit gefixt werden, nicht als Dauerzustand mitgeschleppt. Danach 2 und 3 zusammen (je ein `discardChanges`/`redact`), da sie die Integrität genau der Berichte betreffen, die dieser Task-Typ selbst erzeugt — inklusive dieses Dokuments. Befund 9 bleibt eine Ein-Zeilen-Doku-Korrektur mit stillem Deploy-Skip-Risiko und ist am billigsten zu erledigen.
```

**Zusammenfassung:** Der Code ist seit dem letzten Review (8478b52, 2026-08-11) byte-identisch — die drei Commits seitdem sind reine Berichts-/Idee-Dateien. Alle zehn Befunde bleiben unverändert offen, allen voran Befund 1 (faktisch kein API-Auth-Schutz), jetzt im dritten Review in Folge unangetastet. Quality Gate ist grün (782/782 Tests, Typecheck sauber, Lint unverändert 5 False-Positives). Ich habe nichts committet/gepusht.
