---
type: code-review
repo: AppBaua
commit: 651f29a
date: 2026-08-04
---

# Code-Review: AppBaua (651f29a)

Automatisch erstellt vom appbaua-Worker am 2026-08-04.

# Code-Review appbaua (Branch `dev`, Stand 651f29a)

```
---
type: code-review
repo: AppBaua
commit: 651f29a
date: 2026-08-04
---
```

Bezug: [delivery/reviews/2026-07-26-code-review-appbaua-a3876c5.md](delivery/reviews/2026-07-26-code-review-appbaua-a3876c5.md). Seitdem sind 63 Commits gelandet (Passkey-Auth/req-023, Cloudflare Tunnel/req-024, Test-Gate req-019/025, mehrere Bugfixes bis bug-018). Von den dortigen Befunden sind **fixed**: #1 (Push-Fehler wird jetzt korrekt als Fehler behandelt, inkl. Rebase-Retry aus bug-017), #7 (deckt sich mit #1). **Weiterhin offen**: #2 (Zeitzone), #3 (Analyse-Task committet Fremdänderungen — jetzt sogar zwei betroffene Task-Typen statt einem), #4 (Bericht ungeredigiert), #6 ("heute schon gelaufen" hängt am 500er-Fenster). Neu hinzugekommen ist ein gravierender Auth-Befund, der #8 aus dem letzten Review in neuer Form reproduziert — die Passkey-Umstellung hat die Angriffsfläche geschlossen aussehen lassen, ohne sie tatsächlich zu schließen.

**Quality Gate:** `npm test` lieferte zunächst 118/476 Fehlschläge — Ursache war ausschließlich `NODE_ENV=production` in meiner eigenen Shell (Container-Standard laut `lib/test-gate.ts`-Kommentar); mit `NODE_ENV=development` sind es **782/782 grün**. `npm run typecheck` sauber. `npm run lint` meldet 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` — geprüft und als False Positives verifiziert (die fehlenden Deps sind `useState`-Setter aus der Elternkomponente, deren Identität React garantiert stabil hält; ESLint kann das über die Prop-Grenze hinweg nicht beweisen). `npm audit` meldet 3 High-Findings (PostCSS, sharp), beide nur über `next@15.5.21` transitiv und nur per Breaking-Upgrade auf `next@16` behebbar — siehe unten.

---

## Kritisch

### 1. Middleware prüft nur "Cookie vorhanden", nicht "Session gültig" — fast alle API-Routen bleiben faktisch unauthentifiziert
`middleware.ts:38` — `const hasCookie = Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Jeder Request mit dem Header `Cookie: appbaua_session=x` (Cookie-Name ist öffentlich, `lib/auth-cookie-name.ts:7`) kommt durch die Middleware, egal ob dieser Wert je eine reale Session war. Der Kommentar direkt darüber (`middleware.ts:7-12`) behauptet ausdrücklich: *"A stale/forged cookie value still gets bounced at that second check"* — diese zweite Prüfung (`currentUser()`/`userIdForSession()`) existiert aber nur in drei Routen: `app/api/auth/me`, `app/api/auth/backup-codes`, `app/api/auth/invitations`. Verifiziert an zwei Beispielen: `app/api/repos/route.ts` (`GET`/`POST`) und `app/api/repos/[id]/appbaua/route.ts` rufen `listRepos`/`addRepo`/`convertRepoToAppbaua` direkt auf, ohne die Session je zu prüfen. Ebenso betroffen: `app/api/repos/[id]/route.ts`, `.../model/route.ts`, `.../reorder/route.ts`, `app/api/github-repos/route.ts`, alle `app/api/task-types/**`, `app/api/worker-state/route.ts`, `app/api/worker-status/route.ts`, `app/api/run-log/route.ts`, `app/api/system-metrics/route.ts`.

Beide Umgebungen (dev **und** prod) sind laut `delivery/devops.md` bereits über einen eigenen Cloudflare Tunnel aus dem Internet erreichbar. Mit einem geratenen/leeren Cookie-Wert kann jeder: Repos aus der GitHub-PAT-Liste einsehen (`/api/github-repos`), beliebige Repos hinzufügen/löschen, `POST /api/repos/[id]/appbaua` auslösen (pusht den appbaua-Standard mit dem gespeicherten PAT in ein fremdes Repo), Task-Typen/Worker-Hauptschalter umstellen. Das ist im Kern derselbe Befund wie #8 im letzten Review — nur diesmal hinter einer Prüfung versteckt, die aussieht wie Auth, es aber nicht ist.

**Fix:** Die im Middleware-Kommentar versprochene zweite Prüfung tatsächlich in jede nicht-öffentliche Route (oder in einen gemeinsamen Wrapper/Helper) einbauen, der `userIdForSession` aufruft und bei ungültiger Session 401 liefert — nicht nur in den drei Auth-eigenen Routen.

### 2. Der Code-Review- und der Doku-Task committen weiterhin fremde Änderungen
`lib/execute-step.ts:531-534` (recurring/Code-Review) und `:464-485` (Doku) rufen vor `push()` kein `discardChanges` auf — im Gegensatz zu `idea` (`:421`) und `security` (`:438`), die das korrekt tun. Da `commitAndPush` intern immer `git add -A` macht (`lib/workspace.ts:493`), landet **alles**, was Claude während des Laufs sonst noch im Arbeitsverzeichnis angefasst hat, im selben Commit wie der Bericht bzw. die Doku-Seiten — unter einer Commit-Message, die das nicht erkennen lässt (`worker: Code-Review durchgeführt` / `worker: Doku aktualisiert`). Das ist Befund #3 aus dem letzten Review, jetzt auf zwei Task-Typen statt einem, und weiterhin ohne Test.

**Fix:** `discardChanges(dir)` vor `fileReport`/`push` in beiden Zweigen ergänzen (Doku-Zweig: nur die tatsächlich gewollten Pfade unter `site/user-docs/` behalten, alles andere verwerfen).

### 3. Der abgelegte Bericht geht weiterhin ungeredigiert ins Repo
`fileReport` (`lib/execute-step.ts:660-685`) reicht `report` unverändert an `reportContent`/`writeRepoFile` weiter. `redact()` wird nachweislich nur auf Log-Nachrichten (`lib/worker-loop.ts:186,201`) und auf Git-Fehlerausgaben (`lib/workspace.ts`, neun Stellen) angewendet — nirgends auf den Berichtsinhalt selbst. Zitiert Claude im Review-/Security-/Doku-Lauf versehentlich einen Token aus einer `env`-Ausgabe oder einem Tool-Ergebnis, landet er dauerhaft und unwiderruflich in der Git-Historie. Unverändert seit dem letzten Review (dort Befund #4).

**Fix:** `redact(report)` in `fileReport`, bevor der Inhalt geschrieben wird.

---

## Wichtig

### 4. Container laufen weiterhin in UTC, Zeitfenster werden lokal ausgewertet
Kein `TZ` und kein `tzdata` in `docker-compose.yml`, `Dockerfile` oder `Dockerfile.worker` (geprüft: kein Treffer). `lib/scheduling.ts` und `lib/task-source.ts` rechnen weiterhin mit lokalen `Date`-Methoden. Unverändert seit dem letzten Review (dort Befund #2) — jedes eingestellte Zeitfenster läuft im Betrieb 1–2h verschoben zur deutschen Ortszeit, die der Nutzer in der Oberfläche einstellt.

### 5. "Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster
`lib/worker-loop.ts:160` — `log.list(0, 500)` statt einer echten Tages-Abfrage im Store. Unverändert seit dem letzten Review (dort Befund #6): Ein dauerhaft fehlschlagender Schritt (viele Repos × Task-Typen) kann das Fenster leerlaufen lassen, sodass ein wiederkehrender Task (Review/Doku/Ideen) am selben Tag doppelt läuft.

### 6. `NODE_ENV=production` leckt weiterhin in Claudes eigene Kindprozesse
`lib/test-gate.ts` wurde in bug-015 korrekt gefixt (`DEV_TEST_ENV` für Install *und* Testlauf des offiziellen Gates). `lib/claude-runner.ts` setzt dagegen nirgends ein eigenes `NODE_ENV` (verifiziert per Suche — kein Treffer). Führt Claude während einer Aufgabe selbst `npm install`/`npm test` aus (nicht über den offiziellen Gate-Pfad, sondern z. B. um einen Fix zu verifizieren), erbt dieser Kindprozess weiterhin `NODE_ENV=production` vom Worker-Container — exakt das Bug-010/bug-015-Muster, nur außerhalb des Gates. Claude kann so während einer Aufgabe fälschlich "rot" sehen (fehlende devDependencies, React ohne `act()`) und danach einen nicht existierenden Bug "reparieren".

**Fix:** Denselben `DEV_TEST_ENV`-Ansatz auch für den `spawn`-Aufruf in `claude-runner.ts` (bzw. generell für alle Kindprozesse des Worker-Containers) anwenden.

### 7. Lost-Update-Race in allen Repo-/Task-Typ-Mutationen
`lib/repo-service.ts` und `lib/task-service.ts` folgen durchgängig dem Muster `list()` → mutieren → `replace()`, zwei getrennte Aufrufe ohne Sperre — reproduzierbar bei allen drei Backends (Memory, File, Postgres), weil JS an jedem `await` unterbricht. Konkret: `addRepo()` (`lib/repo-service.ts:44-63`) liest die Liste, wartet dann auf `checkReachable()` (echter Netzwerk-Roundtrip) und ruft erst danach `replace()`. Jede Mutation, die währenddessen läuft (Toggle, Reorder, ein zweites `addRepo`, der Worker-Loop selbst beim Statusschreiben), liest denselben alten Stand und überschreibt beim eigenen `replace()` die Änderung des anderen. Das Muster für die korrekte Lösung existiert im Repo bereits (`queueAppbauaStandard`, `lib/appbaua-standard.ts:436-440`, serialisiert per Promise-Kette), wird hier aber nicht wiederverwendet. Kein Test deckt gleichzeitige Mutation ab.

### 8. Auth-Bootstrap: TOCTOU erlaubt einen zweiten Operator
`lib/auth-bootstrap.ts:27-33` — `countUsers() > 0` und das anschließende `createUser()` sind nicht transaktional verbunden, und `schema.sql` hat keinen Unique-Index auf `is_operator`. Zwei gleichzeitige `POST /api/auth/bootstrap/start` in dem kurzen Fenster vor dem Abschluss der ersten Ersteinrichtung können beide den Zähler-Check passieren und beide einen Operator-Account anlegen. Da die App laut `delivery/devops.md` ab dem Deploy sofort über den Tunnel erreichbar ist, ist dieses (schmale) Fenster real.

### 9. Doku in `devops.md`/`docker-compose.yml` zeigt auf einen Pfad, den der Deploy-Workflow nie liest
`docker-compose.yml:4-5` und `delivery/devops.md:24,54` verweisen auf `deploy/dev.env`/`deploy/prod.env`. Der tatsächliche Deploy (`.github/workflows/deploy.yml:41,44`) und `delivery/deploy-setup.md` lesen dagegen `$HOME/appbaua-env/dev.env`/`prod.env` — sogar `docker-compose.yml`s eigener Kommentar in Zeile 79 widerspricht dem eigenen Dateikopf. Wer der `devops.md` wörtlich folgt (genau das, was der Worker tun soll), legt eine Datei an, die der reale Workflow nie sieht — der "Check env file exists"-Schritt überspringt den Deploy dann nur mit einer stillen `::warning::`. Zusätzlich ist `deploy/` weder in `.gitignore` noch `.dockerignore` ausgeschlossen, ein nach dieser (falschen) Anleitung angelegtes File mit `CLOUDFLARE_TUNNEL_TOKEN` wäre also nicht durch dieselbe Absicherung geschützt wie `~/appbaua-env/*.env`.

### 10. Unbegrenzte Prozessausgabe im Speicher, kein Memory-Limit auf dem Worker-Container
`lib/workspace.ts:71-98` (`run()`) sammelt `stdout`/`stderr` weiterhin unbegrenzt für bis zu 60-minütige Claude-Läufe (unverändert seit dem letzten Review, dort Befund #5). Neu geprüft: `docker-compose.yml` setzt für keinen Service (`worker`, `app`, `db`) ein `mem_limit`. Der Beelink-Host betreibt laut `delivery/deploy-setup.md` weitere, nicht verwandte Projekte — ein durchgelaufener Worker-Container kann bei einem OOM den ganzen Host treffen, nicht nur sich selbst.

---

## Kleinere Punkte

- **`RunLog.tsx` `load()` hat weiterhin keine Fehlerbehandlung** (`components/RunLog.tsx:32-42`), als einzige Komponente ohne try/catch (Settings, WorkerDashboard, SystemMonitor machen es korrekt). Unverändert seit dem letzten Review.
- **pg-store-Retention läuft weiterhin bei jedem Insert** (`lib/pg-store.ts:258-268`): zwei `DELETE`-Queries pro Log-Zeile, jetzt parametrisiert statt hartkodiert, aber gleiches Kostenprofil wie zuvor bemängelt.
- **File-Store vergibt Log-IDs nach `clear()` neu** (`lib/run-log-store.ts:81-83`), der Memory-Store wurde dafür bereits gefixt (Kommentar "`seq` keeps counting"), der File-Pfad (Zero-Infra-Standard) nicht — `key={e.id}` in `RunLog.tsx` kann dadurch kollidieren.
- **`system-metrics`-`sampleCache` bleibt racy bei gleichzeitigem Polling** (`lib/system-metrics-host.ts:58`), mehrere offene Tabs können sich gegenseitig in den teuren Bootstrap-Pfad zwingen statt eine Baseline zu teilen.
- **Memory-Repo-Store backfillt `model` nicht** wie File-/Pg-Store (`lib/store.ts:52-63` vs. File-Store `:39` / `lib/pg-store.ts:114`) — Verhaltens-Divergenz zwischen Backends, testrelevant, praktisch nur den Memory-Pfad betreffend.
- **Backup-Code-Format weicht vom eigenen Kommentar und von der UI ab**: `lib/auth-recovery.ts:12-16` beschreibt "10 random bytes → 16 base32 chars", der Code erzeugt tatsächlich 20 Hex-Zeichen in 5 Blöcken; `app/recovery/page.tsx:104` zeigt als Platzhalter aber nur 4 Blöcke. Kein Sicherheitsproblem (80 Bit Entropie reichen), aber ein sichtbarer UX-Bug beim Eingeben eines Codes.
- **`npm audit`: 3 High-Findings** (PostCSS XSS/Path-Traversal, sharp/libvips CVEs), beide ausschließlich transitiv über `next@15.5.21`; Fix nur per `next@16` (Breaking Change) — für später einplanen, akut kein direkt ausnutzbarer Pfad im Code selbst gefunden.
- **Kein Memory-/CPU-Limit auf `app`/`db`** — niedrigere Priorität als der Worker-Container (Punkt 10), aber aus Konsistenzgründen dieselbe Behandlung wert.
- **`next lint` ist deprecated** (Next 15.5), Migration auf Flat Config vor Next 16 einplanen (bereits im letzten Review vermerkt).

---

## Was gut ist

Die als kritisch gemeldeten Push-Fehler aus dem letzten Review sind sauber gefixt: `pushFailed()` wird jetzt konsequent auf jedem Pfad geprüft, und `commitAndPush` (`lib/workspace.ts`) rebased bei einem veralteten Branch genau einmal nach, bevor es aufgibt (bug-017) — beides mit Tests, die die Reihenfolge prüfen, nicht nur das Ergebnis. `runTestGate` wird für **jeden** dateigetriebenen Schritt unconditional vor dem Verschieben nach `done/` aufgerufen, kein Skip-Pfad gefunden; die `NODE_ENV`-Behandlung im offiziellen Gate (bug-010/bug-015) ist korrekt und mit gutem Kommentar versehen. Der Worker-Loop selbst ist gegen Abstürze robust: jede Stufe (Schritt, Pass, `worker/index.ts`) fängt Fehler sauber ab, plus globale `unhandledRejection`/`uncaughtException`-Handler — kein Crash-Pfad gefunden.

SQL ist überall parametrisiert, keine Injection gefunden. Die WebAuthn-Ceremonies selbst sind sorgfältig gebaut: Origin/rpId werden serverseitig geprüft, Challenges sind Single-Use und kurzlebig (5 Min.), Login/Recovery/Invitation liefern durchgängig generische Fehler gegen Enumeration, Cookie-Flags sind korrekt (`httpOnly`, `sameSite: lax`, `secure` in Produktion). Docker/Compose-Hygiene ist solide: kein Docker-Socket- oder Host-Root-Mount, `init: true` für den Worker ist vorhanden und deckt sich exakt mit `docker-compose.test.ts`, `CLOUDFLARE_TUNNEL_TOKEN` steht nirgends als Literalwert im Repo, dev/prod sind über Compose-Projektnamen sauber getrennt, die CI-Workflow-Datei hat keine Injection-Fläche. `lib/doc-site.ts`/`lib/doc-screenshots.ts` sind bewusst defensiv gebaut — jeder Screenshot-Fehler wird abgefangen statt den Doku-Lauf abzubrechen, genau wie in der CLAUDE.md gefordert.

---

**Empfehlung:** Befund 1 (Auth-Bypass) zuerst und mit Vorrang vor allem anderen — die App ist über zwei Cloudflare-Tunnel live im Internet, und der Zustand ist praktisch "kein Login", nur mit einem Kommentar im Code, der das Gegenteil behauptet. Danach 2 und 3 zusammen (beide sind ein `discardChanges`/`redact` je Zeile) — sie schließen den Weg, auf dem ungeprüfte Änderungen bzw. ein Secret dauerhaft ins Repo gelangen, betreffen aber auch die Integrität dieses laufenden Code-Review-Tasks selbst. Befund 9 ist eine Ein-Zeilen-Korrektur, verhindert aber einen leise übersprungenen Deploy. Befund 4 (Zeitzone) bleibt trotz geringem Aufwand (eine Compose-Zeile + `tzdata`) seit zwei Reviews liegen — lohnt sich, endlich zu erledigen.
