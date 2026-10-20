---
type: code-review
repo: AppBaua
commit: 8e5dab4
date: 2026-09-15
---

# Code-Review: AppBaua (8e5dab4)

Automatisch erstellt vom appbaua-Worker am 2026-09-15.

Review durch. Quality Gate live gefahren, alle 14 Vorbefunde am aktuellen Code gegengeprüft, der neue req-036/037/038-Code eigenständig gelesen. Hier der vollständige Bericht:

---
type: code-review
repo: appbaua
commit: 8e5dab4
date: 2026-09-15
---

# Code-Review appbaua (Branch `dev`, Stand 8e5dab4)

Bezug: [delivery/reviews/2026-09-01-code-review-appbaua-b1a6057.md](delivery/reviews/2026-09-01-code-review-appbaua-b1a6057.md). Seitdem sind 30 Commits gelandet, davon ~10 mit echter Code-Änderung: **req-036** (Etappenweise arbeiten), **req-037** (Fehlerart im Verlauf), **req-038** (Netzabbruch ist kein Fehlschlag), **bug-021** (seitliches Verschieben) sowie drei Nachbesserungen an req-036 selbst (Rebase-Retry beim Etappen-Push, `/work` als Volume, Zeitgrenze 60 → 120 min). Das sind ~3.900 Zeilen in 47 Dateien. Auffällig: req-036 und req-037 hat der Nutzer **selbst** umgesetzt, weil der Worker zweimal daran scheiterte — und beide `.md` dokumentieren offen, was dabei nicht fertig wurde. Ich habe alle 14 Vorbefunde direkt am Code gegengeprüft statt sie zu übernehmen.

**Quality Gate (live):** `NODE_ENV=test npx vitest run` → **1163/1163 grün**, 9 übersprungen (75 Testdateien; die 9 sind weiterhin die PHP-Tests des Wächters). `npm run typecheck` sauber. `npm run lint` unverändert exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157). `npm audit`: **nicht mehr 4 High, sondern 3 High + 1 KRITISCH** — siehe Befund 6.

*Hinweis zur Umgebung:* `npm ci` installiert hier ohne `--include=dev` nur 65 statt 510 Pakete, weil `NODE_ENV=production` gesetzt ist. Das ist keine Fehlkonfiguration dieses Containers, sondern dieselbe Wurzel wie Vorbefund 11 (unten).

---

## Kritisch

### 1. Middleware prüft weiterhin nur „Cookie vorhanden" — sechstes Review in Folge
`middleware.ts:38` prüft unverändert nur `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`. Die im Kommentar darüber versprochene zweite Prüfung existiert nach wie vor in genau **3 von 33** `route.ts`-Dateien (`auth/backup-codes`, `auth/invitations`, `auth/me`); `app/page.tsx` lädt weiterhin ungeprüft die Listen (Zeile 10–14).

Nachgeprüft am heutigen Code, unverändert offen: `app/api/health/restart/route.ts:7` startet ohne jede Prüfung einen fremden prod-Container neu (`restartAppContainer` prüft sorgfältig, dass der Container zur App gehört — aber nicht, wer fragt). `app/api/health/analyze/route.ts` gibt Geld beim KI-Anbieter der fremden App aus, ohne Rate-Limit. `app/api/health/settings` und `app/api/repos/[id]/monitored` schalten die Überwachung stumm. Dazu `app/api/repos/*` (inkl. Push mit dem gespeicherten PAT), `app/api/worker-state/*`, `app/api/task-types/*`. Beide Umgebungen stehen laut `delivery/devops.md` über je einen Cloudflare-Tunnel im Internet.

**Fix:** unverändert — `userIdForSession`/`currentUser` in einen gemeinsamen Wrapper, über jede nicht-öffentliche Route. Bei sechs Wiederholungen ist das kein Backlog-Punkt mehr.

### 2. NEU: Die geretteten Etappen werden beim nächsten Lauf vernichtet — das Netz von req-036 hält nicht
Das ist der schwerwiegendste neue Befund, weil zwei Commits (`f8a915f`, `8e5dab4`) und ein Docker-Volume ausdrücklich dafür ausgegeben wurden, genau diesen Verlust zu verhindern.

`pushStages` (`lib/workspace.ts:597`) und `keepStages` (`lib/execute-step.ts:248`) versprechen beide dasselbe:

> „Schlägt der Push fehl, ist das kein Grund, den Lauf anders zu bewerten — die Arbeit liegt dann weiterhin lokal und **wird beim nächsten erfolgreichen Lauf mitgepusht**."

Das stimmt nicht. Jeder Schritt beginnt mit `d.prepareRepo(...)` (`lib/execute-step.ts:341`) → `prepareRepoOnConvention` → `checkoutTracking` (`lib/workspace.ts:314-327`):

```
git checkout -B <branch> origin/<branch>
git reset --hard origin/<branch>
```

Das wirft lokale Commits weg, die das Remote nicht hat — also exakt die geretteten Etappen. Der Kommentar in `discardChanges` argumentiert korrekt, dass `reset --hard` **ohne Ziel** auf HEAD zurücksetzt und Commits stehenlässt; `checkoutTracking` setzt aber **mit Ziel** auf `origin/<branch>` zurück, und das ist eine andere Operation.

Wann greift das? Immer dann, wenn `pushWithRebaseRetry` fehlschlägt und die Arbeit rein lokal bleibt — der häufigste Fall ist der Rebase-Konflikt (`lib/workspace.ts:648-654`: `rebase --abort`, ursprüngliche Ablehnung melden). Danach hat die Arbeitskopie die Etappen-Commits, sie sind ungepusht, und der nächste Schritt für dasselbe Repo — Minuten später, nicht erst beim nächsten Deploy — löscht sie.

Damit ist auch das neue `worker-work`-Volume (`docker-compose.yml:144-155`) für diesen Fall wirkungslos: es schützt gegen Container-Ersatz, aber der Verlust tritt lange vor dem nächsten Deploy ein. Der Commit-Text „Verlorene Etappen: Rebase-Retry auch beim Etappen-Push, /work als Volume" behandelt zwei Symptome und nicht diese Ursache.

**Fix:** vor `checkoutTracking` prüfen, ob `origin/<branch>..HEAD` nicht leer ist, und in dem Fall zuerst pushen (mit demselben Rebase-Retry) statt zu resetten. Alternativ die Etappen vor dem Reset auf einen Rettungs-Branch (`stages/<md>`) legen und pushen — dann ist der Satz im Kommentar wieder wahr. Mindestens aber: den Kommentar korrigieren, denn er begründet heute das Weglassen einer Absicherung, die es nicht gibt.

### 3. NEU: Zwei Netzwerk-Erkennungen widersprechen sich — req-038 hebt req-037 wieder auf
`lib/error-kind.ts` (req-037) begründet in einem sorgfältigen Kommentar, warum die Reihenfolge der Prüfungen die eigentliche Arbeit ist: „Testsuite vor Netzwerk", und eigens die Kategorie **„Rechner am Limit"**, weil `fetch failed: cannot fork()` (bug-018, 14.061 Zombies) den Wortlaut eines Netzwerkfehlers trägt, aber den eigenen Rechner meint.

`lib/network-abort.ts:69-72` (req-038) — die Funktion, die eine Woche später dazukam und **das Verhalten des Workers steuert** — hat keine dieser Absicherungen: sie prüft nur den Timeout-Sonderfall und lässt danach eine Liste von Wortlauten laufen. Ausgeführt am aktuellen Code:

| Meldung | `errorKindOf` (Anzeige) | `isNetworkAbort` (Verhalten) |
|---|---|---|
| `Claude-Lauf: fetch failed: error: cannot fork()` | **resources** | **true** |
| `…: Test-Suite rot: FAIL api.test.ts > connection refused` | **test-red** | **true** |
| `Claude-Lauf: Timeout (120 min) — zuletzt: fetch failed` | **network** | false |

Die Folgen sind nicht kosmetisch, weil `network-abort` in `runOnce` (`lib/worker-loop.ts:192-218`) den **ganzen Durchlauf abbricht**:

- Ein Container, der nicht mehr forken kann, wird dreimal mit je 3 Minuten Pause wiederholt und legt dabei jedes Mal den kompletten Pass still — statt dass der Verlauf „Rechner am Limit" meldet und der Betreiber nachsieht. Das ist bug-018s Fehldiagnose, nur automatisiert.
- Ein Claude-Fehlschlag, dessen letzte 300 Zeichen (`lib/claude-runner.ts:448`) Testausgabe mit „connection refused" tragen, bleibt in `ready/`, wird dreimal wiederholt und dann geparkt — und der Chip daneben sagt „Testsuite rot".
- Ein Timeout mit Netz-Wortlaut am Ende trägt den Chip „Netzwerk" (= wiederholenswerter Aussetzer), wurde aber nach `failed/` geparkt.

Dass `outcome.summary` bei einem gescheiterten Lauf Claudes eigener Antworttext sein kann, macht das realistisch: dieses Repo lässt den Worker regelmäßig an Bugs arbeiten, die Netzwerk-Wortlaute zitieren (bug-018, bug-020, req-038 selbst).

**Fix:** `isNetworkAbort` auf `errorKindOf(text) === "network"` zurückführen. Es gibt keinen Grund für zwei Erkennungen — req-037 hat die Reihenfolge bereits durchdacht und getestet, req-038 verwirft sie.

### 4. Der Doku- und der recurring-Task committen weiterhin fremde Änderungen
**Unverändert seit 2026-08-04.** Am aktuellen Code nachgeprüft: `discardChanges` steht in `lib/execute-step.ts` an Zeile 266 (`keepStages`), 576 (idea), 593 (security) und 816 (`parkFailed`). Der `doc`-Zweig (Push 624) und der recurring-/file-Zweig (Push 719) rufen es weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht, landet alles, was der Lauf sonst angefasst hat, im selben Commit unter einer Message, die das nicht erkennen lässt.

Seit req-036 ist das schlimmer geworden: Claude darf jetzt selbst committen, und der Push dieser Zweige nimmt alle lokalen Commits mit — auch solche, die mit „Doku aktualisiert" nichts zu tun haben.

### 5. Der abgelegte Bericht geht weiterhin unredigiert ins Repo
**Unverändert seit 2026-08-04.** `grep -c redact lib/execute-step.ts` → weiterhin **0**. `fileReport` (`lib/execute-step.ts:865-890`) schreibt `report` unverändert. Die neuen Module machen es an jeder vergleichbaren Stelle richtig; nur der Weg, auf dem *dieses Dokument hier* im Repo landet, tut es nicht.

---

## Wichtig

### 6. NEU: `npm audit` ist von „4 High" auf „1 Kritisch + 3 High" gekippt — und die Einschätzung des letzten Reviews stimmt so nicht mehr
Live gemessen bei `next@15.5.21`:

```
next  9.3.4-canary.0 - 16.3.0-preview.10   Severity: critical
  - Unauthenticated Remote Code Execution on windows-hosted servers (GHSA-p293-qw3h-jr36)
  - Unauthenticated RCE in Image Optimization API when AVIF files are used (GHSA-2xp9-vwfh-vxw4)
nanoid <3.3.18 · postcss <=8.5.22 · sharp <=0.35.4-rc.0   Severity: high
```

Zwei Korrekturen zum letzten Review:

- **`nanoid` und `sharp` sind ohne Breaking Change behebbar.** `npm audit fix --dry-run` ändert `nanoid 3.3.16 → 3.3.19` und `sharp 0.34.5 → 0.35.4` innerhalb der bestehenden Ranges. Das ist ein Einzeiler und war schon beim letzten Review als „nur per `next@16`" abgetan.
- **Für `next` selbst gibt es in der 15.x-Linie keinen Fix.** Der Advisory-Range endet bei `16.3.0-preview.10`; `npm audit fix` hebt auf `15.5.25` und das Finding bleibt. Der Satz „nur per Breaking-Upgrade" gilt also weiterhin — aber jetzt für eine **kritische** RCE, nicht für High-Findings.

Zur Einordnung, ehrlich gerechnet: die Windows-RCE trifft nicht zu (Alpine). Die AVIF-RCE sitzt im Image-Optimizer. `next/image` wird in diesem Repo **nirgends** benutzt (geprüft), `images.remotePatterns` ist leer, also nimmt `/_next/image` keine fremden URLs an — der Angreifer bräuchte eine AVIF-Datei von der eigenen Origin. Das ist eng, aber nicht nichts: `/_next/image` ist ausgerechnet der eine Serverpfad, den der Middleware-Matcher (`middleware.ts:54`) ausdrücklich ausnimmt, also der einzige, der ohne Sitzung erreichbar ist.

**Fix:** zwei getrennte Schritte. (a) `npm audit fix` für nanoid/sharp — heute, kostet nichts. (b) `images: { unoptimized: true }` in `next.config.ts` — eine Zeile, die den verwundbaren Endpunkt abschaltet, den diese App ohnehin nicht benutzt, und die kritische Bewertung damit gegenstandslos macht, ohne auf `next@16` zu warten.

### 7. NEU: `lib/acceptance-criteria.ts` ist toter Code — req-036 besteht aus Prompt-Text
102 Zeilen, sechs exportierte Funktionen (`criteriaOf`, `nextOpen`, `allDone`, `markDone`, `progressLabel`, `stageCommitMessage`), 14 Tests, ein ausführlicher Entwurfskommentar über die Wahl der Häkchen als Gedächtnis. Aufgerufen wird davon in der Produktion **nichts** — `grep` findet außerhalb von `acceptance-criteria.test.ts` keinen einzigen Treffer.

Die `.md` von req-036 benennt das unter „Was NICHT umgesetzt ist" halb: „Das Fortsetzen ist Claudes Sache." Tatsächlich ist es nicht halb, sondern ganz: Etappen-Schnitt, Häkchen setzen, Commit-Nachricht, Fortschrittsanzeige — alles hängt daran, dass Claude die Prosa in `fileTaskPrompt` (`lib/claude-runner.ts:105-145`) befolgt. Das erklärt auch das offene Ende von AC 7 („im Verlauf steht, welche Kriterien erledigt wurden") — der Worker liest die `.md` nie, also kann er es nicht wissen.

Das ist die teuerste Stelle des Blocks: 14 Tests geben Sicherheit über Code, der nie läuft, und verdecken, dass die einzige Absicherung eine Bitte an ein Sprachmodell ist. Entweder `criteriaOf`/`allDone` in `executeStep` einhängen (dann kann der Worker vor dem Move nach `done/` prüfen, ob wirklich alle Häkchen sitzen — das wäre AC 6), oder das Modul samt Tests entfernen und im Requirement festhalten, dass die Etappen prompt-getrieben sind.

### 8. NEU: Beim Timeout wandert die `.md` doch nach `failed/` — AC 4 von req-036 ist nicht erfüllt
req-036 ist an dieser Stelle unmissverständlich:

> „Bricht der Lauf danach ab — Verbindungsabbruch, **Zeitüberschreitung**, Rate-Limit —, bleibt das Erreichte stehen und die `.md` bleibt in `ready/`. Sie wandert NICHT nach `failed/`, denn an ihr ist nichts falsch."

Der Code tut das für Rate-Limit, abgelaufene Anmeldung und Netzabbruch — für die Zeitüberschreitung nicht. `isNetworkAbort` schließt den Timeout bewusst aus (`lib/network-abort.ts:59-61`), also fällt er in den gewöhnlichen Fehlerzweig (`lib/execute-step.ts:550-563`): erst `keepStages` (pusht die Etappen), dann `parkFailed` (verschiebt nach `failed/`).

Das Ergebnis ist der unangenehmste denkbare Zustand: die halbfertige Arbeit liegt auf `dev`, das Paket liegt in `failed/`, und kein Durchlauf nimmt es wieder auf. Der Kommentar direkt darüber benennt den Fall sogar — „Der haeufigste Fall hier ist die 60-Minuten-Grenze: Die .md wandert **zu Recht** nach failed/" — und widerspricht damit dem Requirement, ohne das zu erwähnen.

Nebenbei: derselbe Kommentar sagt „60-Minuten-Grenze", seit `ac2c9b6` sind es 120. Ebenso `lib/network-abort.ts:55`.

**Fix:** entweder den Timeout wie die anderen drei Abbrüche behandeln (`.md` bleibt in `ready/`, mit demselben Zähler-Schutz wie req-038, damit ein Paket nicht ewig timeoutet), oder req-036 ändern und begründen, warum die Zeitüberschreitung anders zählt. Der heutige Zwischenstand ist die einzige Variante, die beides verliert.

### 9. NEU: `parkFailed` pusht seit req-036 fremde Commits — sein eigener Kommentar ist dadurch falsch geworden
`lib/execute-step.ts:789-792`:

> „Everything the failed attempt left behind is discarded first, so the commit carries **the move and nothing else**: a half-finished attempt must never reach dev."

Diese Zusicherung ruhte darauf, dass Claude nicht committen durfte. Seit req-036 darf er, und `discardChanges` (`reset --hard` ohne Ziel + `clean -fd`) lässt Commits stehen — genau wie req-036 es beabsichtigt. `parkFailed` ruft danach `commitAndPush`, und `git push origin <branch>` schiebt alle lokalen Commits mit.

Der unangenehmste Weg dorthin ist das rote Test-Gate (`lib/execute-step.ts:664-679`): dort wird `parkFailed` ohne vorheriges `keepStages` aufgerufen — die Etappen landen trotzdem auf `dev`, nur ungezählt und ohne Erwähnung im Verlauf. Anders gesagt: der Zweig, dessen Aufgabe es ist, einen roten Stand **nicht** durchzulassen, pusht ihn.

Entwarnung an einer Stelle: der Deploy-Workflow hat `deploy: needs: test` (`.github/workflows/deploy.yml`), also fährt ein roter Stand keinen dev-Deploy. Er macht aber die CI auf `dev` rot, und der nächste Push bleibt daran hängen.

**Fix:** `parkFailed` explizit machen, was es meint — `git reset --hard origin/<branch>` statt `discardChanges`, wenn wirklich nur der Move committet werden soll; oder die Etappen bewusst vorher über `keepStages` sichern und im Verlauf nennen. Was heute passiert, ist keine der beiden Absichten, sondern der Rest einer nicht nachgezogenen Annahme.

### 10. Der `health-agent` vertraut seinem Netz vollständig
**Unverändert.** `grep -n "TOKEN\|timingSafeEqual\|authoriz\|secret" agent/*.ts` → **kein Treffer**. Jeder Prozess im Compose-Netz kann weiterhin `GET /containers/<id>/env?name=…` (jede benannte Variable jedes Containers), `POST /containers/<id>/restart` und `GET /containers/<id>/logs`. Fix bleibt: ein `HEALTH_AGENT_TOKEN`, Vergleich mit `timingSafeEqual` als erstes im Handler.

### 11. `psql` in der Erlaubnisliste ist faktisch beliebige Befehlsausführung
**Unverändert.** `lib/docker.ts:37-44` prüft weiterhin ausschließlich `cmd[0]`. `psql -c '\! …'` und `COPY … FROM PROGRAM …` bleiben erreichbar. Heute nur mit Zugang zum Compose-Netz ausnutzbar (Befund 10), aber die Kommentare in `agent/index.ts:16-17` und `lib/docker.ts:31-33` behaupten weiterhin etwas anderes.

### 12. Die Web-Prüfung wertet „konnte nicht geprüft werden" als Rot
**Unverändert.** `lib/health-checks.ts:197-201`: jeder Fehler aus `fetchImpl` setzt `failed = true`. Nach zwei Runden meldet Telegram — pro überwachter App, mitten in der Nacht, über Apps, denen nichts fehlt.

Teilfortschritt an der Nachbarstelle: `lib/health-md-source.ts:47-54` unterscheidet jetzt sauber zwischen 404 („gibt es wirklich nicht", darf 10 Minuten zwischengespeichert werden) und allem anderen („konnten nicht nachsehen", wird nicht zwischengespeichert). Das ist genau die richtige Unterscheidung — sie zeigt, dass das Muster verstanden ist. Der Rückgabewert bleibt aber `null`, sodass die Runde während eines GitHub-Ausfalls weiterhin „nicht konfiguriert" meldet statt „unbekannt". Der halbe Weg.

### 13. Die Geheimnisse sollen laut Doku nach `deploy/*.env` — einen Pfad, den der Deploy nie liest
**Unverändert.** `delivery/devops.md` weist an vier Stellen (24, 54, 80, 117) auf `deploy/dev.env` / `deploy/prod.env`; `.github/workflows/deploy.yml` liest ausschließlich `$HOME/appbaua-env/{dev,prod}.env`. Auch der Kopf der `docker-compose.yml` (Zeilen 4–5) nennt noch den toten Pfad, während Zeile 106 im selben Dokument bereits `~/appbaua-env/*.env` sagt. Wer der Anleitung folgt, bekommt keine Fehlermeldung, sondern Stille. `deploy/` steht weiterhin nicht in `.gitignore`.

### 14. Der PHP-Ausfallwächter wird faktisch ungetestet ausgeliefert
**Unverändert, live bestätigt:** `watchdog/watchdog.test.ts (14 tests | 9 skipped)`. Der Deploy-Workflow installiert PHP weiterhin „best effort" (`continue-on-error: true` **plus** `|| true`, ohne vorheriges `apt-get update`). Die gesamte Entscheidungslogik des Wächters — Token-Prüfung, Alarm nach Frist, genau eine Nachricht, Entwarnung — läuft damit in keinem Lauf, der nachweisbar wäre.

### 15. Weitere Vorbefunde, am aktuellen Code nachgeprüft und unverändert offen
- **Container laufen in UTC.** `grep TZ docker-compose.yml Dockerfile*` → kein Treffer. Zeitfenster der Task-Typen bleiben 1–2 h gegen deutsche Ortszeit verschoben.
- **„Heute schon gelaufen" hängt an einem 500-Zeilen-Fenster** (`lib/worker-loop.ts:177`). Mit req-037/038 schreibt der Verlauf jetzt zusätzlich Netzabbruch-Pausen — das Fenster füllt sich noch schneller.
- **`NODE_ENV=production` leckt in Claudes eigene Kindprozesse** (`lib/claude-runner.ts` setzt es nicht; `lib/test-gate.ts:56` macht es für das offizielle Gate richtig). Wie eingangs gemessen: dasselbe `npm ci` liefert 65 statt 510 Pakete.
- **Lost-Update-Race in allen Mutationen** — `lib/repo-service.ts`, `lib/task-service.ts`, die Health-Blobs, und neu `createPgNetworkAbortStore` (`lib/pg-store.ts:468-484`): `get()` → mutieren → `set()` auf einen JSON-Blob, ohne Sperre. Der Zähler ist dieselbe Bauform wie alles davor.
- **Auth-Bootstrap: TOCTOU** (`lib/auth-bootstrap.ts:31-38`) — `countUsers() > 0` und `createUser()` weiterhin nicht transaktional.
- **Kein `mem_limit` auf irgendeinem Container** (`grep -c mem_limit docker-compose.yml` → 0), inklusive des Workers mit jetzt 120-Minuten-Läufen und unbegrenzt gesammelter Prozessausgabe (`lib/workspace.ts:96-118`).

---

## Kleinere Punkte

**Neu, aus req-036–038 und bug-021:**

- **`diagnostics` ist eine Spalte ohne Produzenten.** Typ (`lib/run-log.ts:38`), DB-Spalte, JSON-Serialisierung (`lib/pg-store.ts:305`), Fehlertoleranz beim Lesen und Anzeige (`components/RunLog.tsx:192-205`) — alles da, geschrieben wird es nirgends. Die `.md` von req-037 benennt das ehrlich; es bleibt Infrastruktur, die bei jedem Lesen mitgeschleppt wird und nie etwas zeigt.
- **req-037 liegt in `done/` mit 0 von 8 gesetzten Häkchen**, und die Datei listet selbst vier unerfüllte Akzeptanzkriterien auf (Erreichbarkeitsmessung, Filter nach Fehlerart, vollständige Meldung statt 400 Zeichen, Claude-Verlauf beim Fehlschlag). Sie schließt mit „Diese vier gehören in ein Folge-Requirement" — `delivery/requirements/ready/` ist leer, ein solches Requirement existiert nicht. Dasselbe bei req-036 (0 von 8, AC 4/5/6/7 offen). `delivery/stack.md` ist hier eindeutig, und ohne Folge-Requirement verschwindet die Lücke aus dem Blick.
- **`network-abort.ts` importiert `isTransientNetworkError` aus `./workspace`** (Zeile 1) — genau der Import, gegen den `lib/error-kind.ts:3-5` und `lib/browser-imports.test.ts:12-15` eine eigene Datei (`network-errors.ts`) und einen eigenen Test eingeführt haben. Heute folgenlos, weil keine Komponente `network-abort` zieht; der Test deckt nur `components/`, also fällt der Rückfall nicht auf.
- **bug-021: `overflowX: "clip"` an fünf Containern ohne die zugehörige Umbruchregel.** Der Bugreport verlangt ausdrücklich das Gegenteil („Der Fix soll die Ursache beheben, nicht das Symptom … würde den überstehenden Inhalt unlesbar abschneiden"), und die Abschlussnotiz behauptet „Abgeschnitten wird dadurch nichts, weil die Umbruchregeln oben dafür sorgen". Die neuen Umbruchregeln (`overflowWrap: anywhere`) stehen aber nur in `RunLog.tsx`. `TaskControl.tsx` hat überhaupt keine Umbruchregel und jetzt `clip`. Die drei Tests decken ebenfalls nur `RunLog` ab.
- **Die Einrückung ist in vier der fünf Komponenten kaputt** (`AppShell.tsx:438`, `HealthOverview.tsx:234`, `Settings.tsx:150`, `TaskControl.tsx:161` — das `style`-Objekt steht 12 statt 6 Spalten eingerückt). Ein Copy-Paste-Artefakt derselben Änderung; nichts fängt es ab, weil Prettier laut `delivery/stack.md` bewusst noch nicht eingerichtet ist. Genau der Fall, für den es gedacht wäre.
- **`serviceBlockLocal` in `docker-compose.test.ts:152` ist ungenutzt** — der Test darunter ruft die äußere `serviceBlock`. Funktional egal, aber toter Code in einer gerade erst geschriebenen Datei.
- **Das `worker-work`-Volume wächst unbegrenzt.** Ein Klon je jemals bearbeitetem Repo, nichts räumt auf. Auf einem Mini-PC mit `db-data` und `claude-home` im selben Dateisystem ist das eine Frage von Monaten, nicht von Tagen — und `no space left on device` steht bereits in `LOCAL_RESOURCE_PATTERNS`, weil es hier schon einmal weh getan hat.
- **Der Netzabbruch-Zähler wird nie aufgeräumt**, wenn ein Paket verschwindet (umbenannt, Repo entfernt). `withoutKey` läuft nur bei Erfolg und bei `parkFailed`; alles andere bleibt für immer im Blob.
- **`delivery/health.md:46` sagt „bis zu einer Stunde je Paket"** — seit `ac2c9b6` sind es zwei. Die Datei ist ein Maschinen-Vertrag, diese Zeile steht im Prosa-Teil und ist harmlos, aber sie ist die Begründung dafür, dass die Worker-Container unter „Nicht prüfen" stehen.

**Aus früheren Reviews, unverändert:**

- `RunLog.tsx` `load()` weiterhin ohne Fehlerbehandlung (`components/RunLog.tsx:33-43`) — bei einem Fehlschlag bleibt `loading` auf `true` stehen. `HealthOverview.tsx` macht es an derselben Stelle richtig.
- `WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS` (`lib/redact.ts:41`).
- `runRound` listet die Container weiterhin je Repo statt je Runde (`lib/health-checks.ts:498-505`) — der Kommentar sagt „Einmal auflisten", der Aufruf steht in der Repo-Schleife.
- `/neustart`-Rückfrage verfällt nie; Entwarnung ohne vorherige Meldung; Prompt-Injection aus fremden Logs; `flock` fehlt im PHP-Wächter; `check.php` trägt die Kennung als URL-Cronjob in die Zugriffslogs.
- Kommentare zum `health-agent` („genau vier Aufrufe", „kein Netzwerk nach außen") weiterhin unzutreffend.
- pg-store-Retention bei jedem Insert; File-Store vergibt Log-IDs nach `clear()` neu; `sampleCache` racy; Memory-Repo-Store-Backfill nur beim Anlegen; Backup-Code-Format weicht vom eigenen Kommentar ab.
- `next lint` ist deprecated (Warnung bei jedem Lauf) — Migration auf die ESLint-CLI vor Next 16 einplanen; sie gehört ohnehin zu Befund 6.

---

## Was gut ist

Die drei neuen Requirements sind erkennbar aus echtem Schmerz entstanden, und das merkt man den Entscheidungen an. `lib/error-kind.ts` ist das beste Stück Code in diesem Durchgang: Die Reihenfolge der Prüfungen ist nicht nur begründet, sondern mit dem konkreten Vorfall begründet, an dem die naive Reihenfolge falsch lag — und die selbst hinzugefügte Kategorie „Rechner am Limit" ist genau die Art Einsicht, die man nur hat, wenn man den Fall wirklich erlebt hat. Die 14 Tests dazu verwenden durchgehend echten Wortlaut aus dem prod-Verlauf statt erfundener Beispiele; das ist teurer zu beschaffen und deutlich mehr wert.

`lib/browser-imports.test.ts` ist die richtige Reaktion auf einen Fehler, der zweimal auf verschiedenen Wegen aufgetreten ist: statt die zwei Stellen zu reparieren, zieht der Test die Grenze für alle künftigen. Dass er `import type` korrekt ausnimmt, zeigt, dass die Regel verstanden und nicht nur abgeschrieben ist. `lib/health-md-source.ts:47-54` trifft die Unterscheidung „belastbare Antwort vs. konnten nicht nachsehen" endlich sauber, und die Entscheidung, den Fehlerfall **nicht** zwischenzuspeichern, ist die richtige Richtung. Das Herausziehen von `pushWithRebaseRetry` aus `commitAndPush` an eine gemeinsame Stelle ist genau die Konsequenz aus dem Vorfall vom 11.09. — zwei Aufrufer, ein Verhalten, kein zweiter Mechanismus daneben. Und `log-analysis-service.ts:145-156` löst ein reales Ärgernis mit einer Zeile: ein fehlender KI-Abschnitt ist „nichts zu tun", kein Fehler — sechs Fehlereinträge in einer halben Stunde weniger, in denen echte Fehler untergingen.

Bemerkenswert ist auch die Ehrlichkeit der beiden selbst umgesetzten Requirements. Beide `.md` tragen einen Abschnitt „Was NICHT umgesetzt ist", der die Lücken beim Namen nennt, statt sie zu verschweigen — req-036 korrigiert dort sogar eine eigene Annahme aus dem Constraint-Abschnitt („`discardChanges` musste NICHT geändert werden … In einem Wegwerf-Repo nachgestellt und bestätigt"). Genau diese Sorgfalt macht die Befunde 2, 7 und 8 oben überhaupt erst formulierbar: Sie stehen nicht im Widerspruch zu dem, was die Dokumentation behauptet, sondern präzisieren, wo die Dokumentation schon selbst Zweifel angemeldet hat. Ansonsten unverändert solide: `pushFailed()` wird konsequent geprüft, `runTestGate` läuft vor jedem Move nach `done/`, SQL ist überall parametrisiert, die Trennung reine Logik ↔ Naht nach draußen trägt 1163 Tests ohne Docker, ohne Telegram und ohne KI-Anbieter.

---

**Empfehlung:** Befund 1 behält uneingeschränkten Vorrang — sechstes Review, unangetasteter Kern, und dahinter steht weiterhin ein Neustart-Knopf für fremde prod-Container. Danach Befund 2, denn er ist dringender als seine Position nahelegt: Es wurden bereits zwei Commits und ein Volume dafür ausgegeben, Etappen zu retten, und der eigentliche Vernichter (`reset --hard origin/<branch>` beim nächsten Schritt) ist dabei unentdeckt geblieben. Solange das so ist, kostet jeder Rebase-Konflikt genau die Arbeit, die req-036 sichern sollte — und der Kommentar im Code sagt dem nächsten Leser, es sei versorgt. Dann Befund 3, weil er eine Ein-Zeilen-Korrektur ist (`isNetworkAbort` auf `errorKindOf` zurückführen) und dafür verhindert, dass ein voller Container als Netzstörung behandelt wird. Danach 6a (`npm audit fix` für nanoid/sharp) und 6b (`images: { unoptimized: true }`) — zusammen zehn Minuten, und die kritische Bewertung ist weg, ohne auf `next@16` zu warten. Dann 8 und 9, die zusammengehören: beide entstehen daraus, dass req-036 eine alte Annahme („Claude committet nicht") aufgehoben hat, ohne die Stellen nachzuziehen, die auf ihr ruhten. Befund 7 (toter Code) ist keine Störung im Betrieb, gehört aber entschieden, bevor jemand ihn für die Umsetzung hält.

**Zusammenfassung:** Seit b1a6057 sind req-036, req-037, req-038 und bug-021 dazugekommen — zwei davon vom Nutzer selbst gebaut, nachdem der Worker an derselben Netzstörung scheiterte, gegen die sie schützen sollen. Die Diagnose-Seite (req-037) ist handwerklich das Beste in diesem Durchgang; die Ausführungs-Seite (req-036/038) hat drei zusammenhängende Schwächen, die alle dieselbe Wurzel haben: Die Annahme „Claude committet nicht" wurde aufgehoben, aber `checkoutTracking`, `parkFailed` und der Timeout-Zweig ruhen weiterhin darauf. Dazu eine zweite Netzwerk-Erkennung, die die sorgfältig begründete Reihenfolge der ersten verwirft und einen forkunfähigen Container als Netzausfall behandelt. Fünf neue Befunde, alle vierzehn Vorbefunde offen, `npm audit` von High auf Kritisch gekippt — mit zwei Teilen, die ohne Breaking Change behebbar sind. Quality Gate grün (1163/1163 Tests + 9 übersprungen, Typecheck sauber, Lint unverändert 5 False Positives). Ich habe nichts committet und nichts gepusht.
