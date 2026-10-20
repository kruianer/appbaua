---
type: code-review
repo: AppBaua
commit: 305cddc
date: 2026-09-29
---

# Code-Review: AppBaua (305cddc)

Automatisch erstellt vom appbaua-Worker am 2026-09-29.

---
type: code-review
repo: appbaua
commit: 305cddc
date: 2026-09-29
---

# Code-Review appbaua (Branch `dev`, Stand 305cddc)

Bezug: [delivery/reviews/2026-09-22-code-review-appbaua-986c4dd.md](delivery/reviews/2026-09-22-code-review-appbaua-986c4dd.md). Seitdem sind sechs Commits gelandet, davon **genau einer mit Code-Änderung**: `046b076` (bug-023, „Ein Lauf nimmt seinen ganzen Prozessbaum mit") — 211 Zeilen in `lib/workspace.ts`, 7 in `worker/index.ts`, 245 in der neuen `lib/workspace-process-tree.test.ts`. Die übrigen fünf sind Dokumente: der Bugreport, seine Abschlussnotiz, der Move nach `done/`, eine Idee, ein Security-Bericht, der letzte Review-Bericht.

Der Schnitt ist damit derselbe wie beim letzten Mal: Das neue Stück Code ist klein genug, um es Zeile für Zeile zu lesen — das habe ich getan. Der Fix ist gut, und das steht unten ausführlich; gefunden habe ich dabei eine Lücke, die ihn an einer Stelle ins Leere laufen lässt, und zwei Stellen, an denen der Code seine eigene Dokumentation verletzt. Den Rest des Berichts machen die sechzehn Vorbefunde aus, die ich einzeln am heutigen Code nachgeprüft habe, statt sie zu übernehmen. **Alle sechzehn sind unverändert offen.**

**Quality Gate (live gefahren):** `NODE_ENV=test npx vitest run` → **1179/1179 grün**, 9 übersprungen, 76 Testdateien (+10 Tests, +1 Datei = der bug-023-Prüfstand; die 9 sind weiterhin die PHP-Tests des Wächters). `npm run typecheck` sauber. `npm run lint` unverändert exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157). `npm audit --json` → `{high: 3, critical: 1, total: 4}` über `nanoid, next, postcss, sharp` — Paket für Paket identisch zum letzten Review.

---

## Kritisch

### 1. Middleware prüft weiterhin nur „Cookie vorhanden" — achtes Review in Folge
`middleware.ts:38` unverändert: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`, sonst nichts. Heute gezählt: `find app/api -name route.ts` → **33** Routen, und `grep -rln "userIdForSession\|currentUser" app/api/` findet die zweite Prüfung in **3** davon (`auth/backup-codes`, `auth/invitations`, `auth/me`). Das Verhältnis 3:33 ist seit acht Berichten unverändert.

Am heutigen Code nachgesehen: `app/api/health/restart/route.ts` startet weiterhin einen fremden prod-Container neu, und die einzige Prüfung im Handler ist `typeof body.repoId !== "string" || typeof body.container !== "string"`. Wer der Anfragende ist, wird nirgends gefragt. Dazu unverändert `app/api/health/analyze` (gibt Geld beim KI-Anbieter der fremden App aus, ohne Rate-Limit), `app/api/health/settings` und `app/api/repos/[id]/monitored` (schalten die Überwachung stumm), `app/api/repos/*` (inkl. `appbaua`-Rollout mit Push per gespeichertem PAT), `app/api/worker-state/*`, `app/api/task-types/*`. Beide Umgebungen stehen laut `delivery/devops.md` über je einen Cloudflare-Tunnel im Internet.

**Fix:** unverändert — `userIdForSession`/`currentUser` in einen gemeinsamen Wrapper, über jede nicht-öffentliche Route. Bei acht Wiederholungen ist das kein Backlog-Punkt mehr.

### 2. Die geretteten Etappen werden beim nächsten Lauf weiterhin vernichtet
**Unverändert.** `checkoutTracking` (`lib/workspace.ts:503-515`) endet weiterhin mit `git reset --hard origin/<branch>` und wird weiterhin von `prepareRepo` aus aufgerufen (`lib/workspace.ts:580`, `612`), also zu Beginn **jedes** Schritts. `reset --hard` **mit Ziel** wirft lokale Commits weg, die das Remote nicht hat — exakt die Etappen, die `keepStages`/`pushStages` gerettet haben, wenn deren Push scheiterte. Der Kommentar bei `lib/workspace.ts:719` (`git reset --hard` **ohne** Ziel) argumentiert weiterhin korrekt über den anderen Fall und deckt diesen nicht ab.

Das bleibt der teuerste offene Punkt nach Befund 1: Es wurden zwei Commits und ein Docker-Volume dafür ausgegeben, Etappen zu retten, und der eigentliche Vernichter ist weiterhin unangetastet.

### 3. Zwei Netzwerk-Erkennungen widersprechen sich weiterhin
**Unverändert.** `grep -c errorKindOf lib/network-abort.ts` → **0**. `isNetworkAbort` (`lib/network-abort.ts:69`) prüft weiterhin nur `isClaudeTimeout` und läuft danach über eine eigene Wortlaut-Liste, ohne die in `lib/error-kind.ts` begründete Reihenfolge („Testsuite vor Netzwerk", Kategorie „Rechner am Limit"). Ein Container, der nicht mehr forken kann, wird weiterhin als Netzstörung behandelt und legt dreimal den kompletten Pass still.

Das ist dieses Mal mehr als ein Schönheitsfehler: bug-023 beschreibt einen Rechner mit 9,5 von 11 GB belegt und Swap zu 100 %. Genau in diesem Zustand scheitern `spawn`-Aufrufe mit `ENOMEM`/`EAGAIN` — und genau dieser Zustand landet heute in der Schublade „Netzabbruch", wo er zu einer Pause statt zu einer sichtbaren Diagnose führt. Der Fix bleibt der Einzeiler: `isNetworkAbort` auf `errorKindOf(text) === "network"` zurückführen.

Nebenbei: `lib/network-abort.ts:55` sagt weiterhin „60 minutes", seit `ac2c9b6` sind es 120.

### 4. Der Doku- und der recurring-Task committen weiterhin fremde Änderungen
**Unverändert.** `discardChanges` steht in `lib/execute-step.ts` an den Zeilen 266 (`keepStages`), 576 (idea), 593 (security) und 816 (`parkFailed`). Der `doc`-Zweig und der recurring-/file-Zweig rufen es weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht und seit req-036 alle lokalen Commits mitpusht, landet unter „worker: Doku aktualisiert" weiterhin alles, was der Lauf sonst angefasst hat.

### 5. Der abgelegte Bericht geht weiterhin unredigiert ins Repo
**Unverändert.** `grep -c redact lib/execute-step.ts` → weiterhin **0**. `fileReport` schreibt `report` unverändert ins Repo — auch dieses Dokument hier nimmt diesen Weg. Jedes andere neue Modul macht es an der vergleichbaren Stelle richtig.

---

## Wichtig

### 6. NEU: `run()` läuft in zwei Prozessen, verdrahtet ist einer — der Web-Prozess lässt seine Bäume stehen
Das ist die eine echte Lücke im neuen Fix, und sie folgt direkt aus seiner eigenen Begründung.

`installProcessTreeCleanup()` steht genau einmal im Code, in `worker/index.ts:12`. Der Kommentar darüber sagt korrekt, warum es nötig wurde: „Seit jeder Aufruf in einer eigenen Prozessgruppe läuft, stirbt sie nicht mehr automatisch mit der unseren." Dieser Satz gilt für **jeden** Prozess, der `run()` benutzt — und das sind zwei.

Nachverfolgt: `app/api/repos/[id]/appbaua/route.ts:2` → `convertRepoToAppbaua` (`lib/repo-service.ts:114`) → `queueAppbauaStandard` (`lib/appbaua-standard.ts:436`) → `applyAppbauaStandard` → `prepareRepo` (`lib/appbaua-standard.ts:256`) und `commitAndPush` (`:292`), beide aus `lib/workspace.ts`, beide über `run()`. Das läuft im **Next.js-Serverprozess**, nicht im Worker; `Dockerfile:28` installiert `git` ausdrücklich für genau diesen Weg (`# git at runtime: "Auf appbaua umstellen" (req-012)`). `instrumentation.ts` — die einzige Stelle, an der der Web-Prozess einmalig etwas hochfährt — ruft `installProcessTreeCleanup()` nicht auf.

Wirkung: Wird der Web-Container während eines Rollouts beendet oder neu deployt (und ein Rollout klont ein fremdes Repo und schiebt es zurück, das dauert), bleibt dessen git-Prozessbaum als **eigene Session** stehen — losgelöster als vor dem Fix, denn er hängt jetzt nicht mehr in der Gruppe des Servers. Das Container-Ende räumt es über den PID-Namespace noch auf; ein Neustart nur des Node-Prozesses nicht.

**Fix — mit einer Einschränkung, die man kennen muss:** `installProcessTreeCleanup()` einfach in `instrumentation.ts` nachzuziehen wäre zu grob. Die Funktion registriert nicht nur das Abräumen, sondern auch `target.exit?.(0)` auf SIGTERM (`lib/workspace.ts:211`) — im Web-Prozess würde das Next.js' eigenes geordnetes Herunterfahren überholen, weil dieser Listener als erster registriert ist und `process.exit` nicht auf spätere Listener wartet. Der saubere Schnitt ist, die beiden Hälften zu trennen: den `exit`-Teil überall, den Signal-plus-`exit(0)`-Teil nur dort, wo niemand sonst ein Shutdown hat (also im Worker). Ein Parameter, kein Umbau.

### 7. NEU: Der einzige erreichbare Zweig von `killProcessTree` ist der, den seine eigene Dokumentation verbietet
`killProcessTree` (`lib/workspace.ts:143-153`) versucht erst die Gruppe, dann als Rückfall die nackte PID:

```ts
if (killProcessGroup(pid, signal)) return true;
try { process.kill(pid, signal); return true; } catch { return false; }
```

Der Doc-Kommentar darüber begründet den Rückfall mit „eine Plattform ohne setsid" und schreibt die Vorbedingung selbst hin: *„Nur fuer ein Kind, das NACHWEISLICH noch laeuft: nach dem Abraeumen des Kindes darf seine PID nicht mehr einzeln beschossen werden, weil sie da schon neu vergeben sein kann."*

Beides trägt nicht zusammen. Auf Linux erzeugt `detached: true` die Gruppe **immer**; solange das Kind lebt, ist es ihr Anführer, und `kill(-pid, …)` kann nicht mit ESRCH scheitern. Der Rückfall ist also auf dieser Plattform nur dann überhaupt erreichbar, wenn die Gruppe leer ist — und eine leere Gruppe heißt: der Anführer ist weg und abgeräumt. Der Zweig, der laut Kommentar nur für ein nachweislich laufendes Kind gedacht ist, läuft damit ausschließlich gegen eine bereits freigegebene PID.

Beide Aufrufstellen können die Vorbedingung nicht garantieren:
- `lib/workspace.ts:279` (Timeout): Läuft die Zeitgrenze in genau dem Moment ab, in dem das Kind von selbst endet, ist `settled` noch `false`, `timer` noch nicht gelöscht — und `killProcessTree` schießt auf eine reaped PID.
- `lib/workspace.ts:166` (`killAllProcessTrees`): `liveGroups` wird nur in `settle` geleert (`:268`). Im Drain-Fall steht die PID dort noch, während das Kind schon abgeräumt ist; ist inzwischen auch der Enkel gegangen, greift derselbe Zweig.

**Wie schlimm:** operativ praktisch nicht. Ich habe `/proc/sys/kernel/pid_max` gemessen — **4194304**; ein Wiederverwenden derselben Nummer innerhalb von Millisekunden ist nicht realistisch. Ich melde es trotzdem, weil hier eine Funktion eine Vorbedingung dokumentiert, die ihr einziger Produktionsaufrufer strukturell nicht erfüllen kann: Der nächste Leser hält das für abgesichert und baut darauf. Und der Fix ist kleiner als der Kommentar: Den Rückfall entweder streichen (auf Linux ist er nach dem oben Gesagten wirkungslos) oder an ein Flag hängen, das `child.on("exit")` setzt — dann stimmt er wieder mit seiner Beschreibung überein.

### 8. NEU: Nach `settle` bleiben die Ausgabe-Listener hängen — `onData` kann nach dem Auflösen weiterlaufen
`settle` (`lib/workspace.ts:260-271`) löscht alle drei Timer, schießt die Gruppe ab und resolved. Was es **nicht** tut: die Listener auf `child.stdout`/`child.stderr` (`:298-307`) abnehmen.

Solange der Gruppen-Kill greift, fällt das nicht auf. Er greift aber genau dort nicht, wo `settle` überhaupt gebraucht wird: Ein Enkel, der selbst `setsid()` gerufen hat, hat die Gruppe verlassen — `killProcessGroup` erreicht ihn nicht, und wenn er die geerbte Pipe weiter hält, laufen nach dem Auflösen des Promise weiter `stdout += s` und `emit(s)`.

Zwei Folgen, beide konkret: `stdout` wächst in einer Closure, die niemand mehr ausliest (ein Speicherleck in einem Fix gegen ein Speicherleck), und `opts.onData` wird für einen bereits beantworteten Aufruf weiter gerufen. `onData` ist der Weg in den Verlauf — Ausgabe eines abgeschlossenen Schritts landet dann unter dem nächsten.

**Fix:** in `settle` zusätzlich `child.stdout?.removeAllListeners("data")` / dito stderr, oder billiger: `if (settled) return;` als erste Zeile von `emit` (`:288`) und `stdout`/`stderr` nach dem Auflösen nicht mehr anwachsen lassen.

### 9. NEU: Der Pfad, der die beobachteten Waisen tatsächlich erzeugt hat, bleibt ungedeckt — und die Gegenmaßnahme dafür ist weiterhin abwesend
Das ist kein Fehler im Fix, sondern die Frage, ob bug-023 als Ganzes erledigt ist. Ich halte es für wichtig genug, es nicht in den Kleinigkeiten zu verstecken.

Der Bugreport hält als Befund fest: `PPID 2401919` der vier vitest-Prozesse war `/sbin/docker-init`, also **PID 1**. Die Prozesse waren umgehängt worden — ihr ursprünglicher Elternteil war weg, ohne sie mitzunehmen. Der Report beschreibt dazu die Maschinenlage: 9,5 von 11 GB belegt, Swap zu 100 %, der OOM-Killer aktiv.

`installProcessTreeCleanup` deckt `exit`, SIGTERM, SIGINT, SIGHUP (`lib/workspace.ts:177`, `203-213`). Es deckt nicht SIGKILL — und der OOM-Killer schickt ausschließlich SIGKILL. Kein In-Process-Handler kann das; das ist keine Kritik am Code, sondern eine Grenze.

Damit ist der Stand: Der häufige Pfad (Lauf endet, Enkel bleiben) ist geschlossen und gemessen belegt. Der Pfad, der im dokumentierten Schadensfall gelaufen ist (Worker wird unter Speicherdruck hart abgeschossen), bleibt offen — und der Schaden aus bug-023 war ein **fremder** prod-Deploy plus ein Runner-Dienst, der von Hand wiederbelebt werden musste. Der Bugreport verbietet unter „Erwartete Behebung" ausdrücklich ein Speicherlimit **als Ersatz** für die Ursachenbehebung („das verdeckt die Ursache") — nicht als Ergänzung dazu. Jetzt, wo die Ursache behoben ist, entfällt der Grund für das Verbot.

Nachgeprüft: `grep -c mem_limit docker-compose.yml` → **0**, für jeden Container. Nach dem Fix ist ein `mem_limit` am Worker keine Verdeckung mehr, sondern die Obergrenze, deren Fehlen den Ausfall über die Projektgrenze getragen hat. Das gehört als Folge-Requirement in `ready/`, nicht in einen Review-Bericht, der in sieben Tagen erneut dasselbe feststellt.

### 10. `npm audit`: unverändert 1 kritisch + 3 high — zweite Woche mit demselben Zwei-Schritte-Rezept
Live gemessen, identisch zum letzten Review: `next` (critical, 2× unauth. RCE), `postcss` (high, 4 Advisories), `sharp` (high), `nanoid` (high). Alle vier mit `fix available via npm audit fix`.

Der Weg steht seit zwei Berichten vollständig aufgeschrieben: (a) `npm audit fix` hebt nanoid/sharp/postcss innerhalb der bestehenden Ranges; (b) `images: { unoptimized: true }` in `next.config.ts` schaltet den verwundbaren Image-Optimizer ab, den diese App nirgends benutzt, und macht die kritische Bewertung gegenstandslos, ohne auf `next@16` zu warten.

Nachgeprüft: `grep -n images next.config.ts` → **kein Treffer**. Die Windows-RCE trifft weiterhin nicht zu (Alpine); die AVIF-RCE sitzt weiterhin im Optimizer, und `/_next/image` ist weiterhin der eine Serverpfad, den der Middleware-Matcher (`middleware.ts:54`) ausdrücklich ausnimmt.

### 11. bug-022: Eine vom Menschen gesetzte Pause wird weiterhin überschrieben
**Unverändert seit dem letzten Review**, an den heutigen Zeilen nachgeprüft. `lib/worker-loop.ts:412` schreibt weiterhin **bedingungslos** `setPauseUntil(new Date(untilMs).toISOString())`, sobald ein Pass nichts geschafft hat, ohne zu lesen, was gespeichert ist; `runOnce` liest `pause_until` weiterhin nicht. Der Test `worker-loop.test.ts:591` heißt weiterhin „eine vom Menschen gesetzte Pause überschreibt der Worker nicht" und prüft weiterhin nur, dass nie `null` geschrieben wurde — das Überschreiben sammelt er ein und schaut daran vorbei. Ein Test, der das Gegenteil seines Namens belegt, wird beim nächsten Lesen als Absicherung gezählt.

### 12. `lib/acceptance-criteria.ts` ist weiterhin toter Code
**Unverändert.** `grep -rn "acceptance-criteria"` über alle `.ts`/`.tsx` → **genau ein Treffer**, die eigene Testdatei. 102 Zeilen, sechs exportierte Funktionen, 14 Tests, die in diesem Lauf grün liefen — über Code, der in der Produktion nie aufgerufen wird.

### 13. Beim Timeout wandert die `.md` weiterhin nach `failed/` — AC 4 von req-036 bleibt unerfüllt
**Unverändert.** `lib/network-abort.ts:70` schließt den Timeout weiterhin ausdrücklich aus (`if (!text || isClaudeTimeout(text)) return false`), also fällt er in den gewöhnlichen Fehlerzweig: `keepStages`, dann `parkFailed`. Ergebnis unverändert: halbfertige Arbeit auf `dev`, Paket in `failed/`, kein Durchlauf nimmt es wieder auf.

### 14. `parkFailed` pusht weiterhin fremde Commits
**Unverändert.** `lib/execute-step.ts:816` ruft weiterhin `discardChanges` (das Commits stehenlässt) und danach `commitAndPush` (das alle lokalen Commits mitschiebt), während der Kommentar darüber weiterhin verspricht, der Commit trage nur den Move. Der unangenehmste Weg bleibt das rote Test-Gate: `parkFailed` ohne vorheriges `keepStages` — der Zweig, der einen roten Stand nicht durchlassen soll, pusht ihn.

### 15. Der `health-agent` vertraut seinem Netz weiterhin vollständig
**Unverändert.** `grep -c "TOKEN\|timingSafeEqual\|authoriz\|secret" agent/index.ts agent/routes.ts` → **0 und 0**. Jeder Prozess im Compose-Netz kann weiterhin `GET /containers/<id>/env?name=…`, `POST /containers/<id>/restart` und `GET /containers/<id>/logs`.

### 16. `psql` in der Erlaubnisliste ist weiterhin faktisch beliebige Befehlsausführung
**Unverändert.** `lib/docker.ts:35`: `ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"]`, und `isAllowedCommand` prüft weiterhin ausschließlich `cmd[0]`. `psql -c '\! …'` und `COPY … FROM PROGRAM …` bleiben erreichbar. Der Kommentar darüber behauptet weiterhin, alles andere wäre „beliebige Befehlsausführung als root" — als sei `psql` das nicht.

### 17. Die Web-Prüfung wertet „konnte nicht geprüft werden" weiterhin als Rot
**Unverändert.** `lib/health-checks.ts:197-199`: jeder Fehler aus `fetchImpl` setzt `failed = true`, und der Text sagt „keine Antwort". Nach zwei Runden meldet Telegram — pro überwachter App, mitten in der Nacht, über Apps, denen nichts fehlt.

### 18. Geheimnisse sollen laut Doku nach `deploy/*.env` — einen Pfad, den der Deploy nie liest
**Unverändert.** `delivery/devops.md` weist weiterhin an vier Stellen (24, 54, 80, 117) auf `deploy/dev.env` / `deploy/prod.env`; `.github/workflows/deploy.yml:50,53` liest ausschließlich `$HOME/appbaua-env/{dev,prod}.env`. Der Kopf der `docker-compose.yml` (Zeilen 4–5) nennt weiterhin den toten Pfad, während Zeile 106 derselben Datei schon `~/appbaua-env/*.env` sagt. `grep -c deploy .gitignore` → **0**: Wer der Anleitung folgt, legt Geheimnisse in einem nicht ignorierten Verzeichnis ab und bekommt keine Fehlermeldung, sondern Stille.

### 19. Der PHP-Ausfallwächter wird weiterhin faktisch ungetestet ausgeliefert
**Unverändert, live bestätigt:** `watchdog/watchdog.test.ts (14 tests | 9 skipped)` in diesem Lauf. Token-Prüfung, Alarm nach Frist, genau eine Nachricht, Entwarnung — nichts davon läuft in einem nachweisbaren Lauf.

### 20. Weitere Vorbefunde, am heutigen Code nachgeprüft und unverändert offen
- **Container laufen in UTC.** `grep -c TZ` → **0** in `docker-compose.yml`, `Dockerfile`, `Dockerfile.worker`, `Dockerfile.agent`. Zeitfenster der Task-Typen bleiben 1–2 h gegen deutsche Ortszeit verschoben.
- **`WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS`** (`grep -c WATCHDOG_TOKEN lib/redact.ts` → 0).
- **„Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster** (`lib/worker-loop.ts`).
- **`NODE_ENV=production` leckt weiterhin in Claudes Kindprozesse**; `lib/test-gate.ts` macht es für das offizielle Gate richtig. (Die Umgebungsweitergabe in `run()` ist von bug-023 unberührt: `env: { ...process.env, ...opts.env }` steht unverändert in `lib/workspace.ts:225`.)
- **Lost-Update-Race in allen Blob-Mutationen** — `repo-service`, `task-service`, die Health-Blobs, `createPgNetworkAbortStore`.
- **Auth-Bootstrap: TOCTOU**, `countUsers()`/`createUser()` weiterhin nicht transaktional.
- **`diagnostics` bleibt eine Spalte ohne Produzenten**; **req-036/037 liegen weiterhin mit 0 gesetzten Häkchen in `done/`**, und `delivery/requirements/ready/` enthält weiterhin kein Folge-Requirement für die dort benannten offenen Kriterien.
- **bug-021: `overflowX: "clip"` weiterhin ohne Umbruchregel in `TaskControl.tsx`**; die kaputte Einrückung in vier Komponenten ebenso.
- **`serviceBlockLocal` in `docker-compose.test.ts:152` weiterhin ungenutzt**; das `worker-work`-Volume wächst weiterhin unbegrenzt; der Netzabbruch-Zähler wird weiterhin nie aufgeräumt.
- **`next lint` ist deprecated** — die Warnung steht bei jedem Lauf im Log, und die Migration gehört ohnehin zu Befund 10.

---

## Kleinere Punkte

**Neu, aus bug-023:**

- **`killAllProcessTrees` räumt `liveGroups` nicht leer** (`lib/workspace.ts:161-168`). Das Entfernen passiert ausschließlich in `settle` (`:268`). Im Signal-Pfad ist das folgenlos, weil danach `process.exit` kommt; ein zweiter Aufruf ohne Prozessende meldet aber dieselben Bäume erneut und liefert eine Zahl, die nichts mehr bedeutet. Da `liveProcessTreeCount()` ausdrücklich „fuer Diagnose" exportiert ist, ist das der Ort, an dem es später einmal falsch gelesen wird.
- **Exit-Code 0 auf SIGTERM** (`lib/workspace.ts:211`, `target.exit?.(0)`). Konvention ist 128+Signal, also 143. Mit `restart: unless-stopped` ist das betrieblich folgenlos, aber ein `docker stop` und ein regulärer Abschluss sind danach in den Logs nicht mehr auseinanderzuhalten — auf einem Rechner, auf dem gerade ein Dienst nach einem OOM-Kill nicht von selbst wiederkam, ist genau das die Information, die man später sucht.
- **Der Prüfstand des Leck-Fixes kann selbst lecken.** `grandchildPid` (`lib/workspace-process-tree.test.ts:87-93`) macht `expect(m).toBeTruthy()` **vor** `spawnedPids.push(pid)`. Schlägt das Auslesen der Enkel-PID fehl, wirft `expect`, die PID wird nie registriert, und `afterEach` (`:27-35`) räumt sie nicht ab. Ein rot gewordener Test über verwaiste Prozesse hinterlässt dann einen verwaisten Prozess. Zwei Zeilen: erst regexen und pushen, dann zusichern.
- **Die neuen Tests hängen an Wanduhr-Fristen** — `timeoutMs: 300` mit `killGraceMs: 500` (`:96-131`), `goneWithin(…, 3000)`, `expect(Date.now() - started).toBeLessThan(10_000)`. Fachlich ist es richtig, das an echten Prozessen zu messen; der Bugreport begründet gut, warum eine Naht das nicht gezeigt hätte. Nur läuft dieses Gate auf genau dem Beelink, der in bug-023 nachweislich in Swap gelaufen ist, und bei 300 ms ist die Grenze zwischen „Timeout greift" und „Prozess war noch nicht bereit" schmal. Ein Flake hier ist kein Schönheitsfehler, sondern blockiert nach `delivery/stack.md` die Promotion. Die Fristen sind über `killGraceMs` schon parametrisiert — sie großzügiger zu setzen kostet nur Sekunden Laufzeit.
- **`opts.killGraceMs` hat außerhalb der Tests keinen Aufrufer.** `grep killGraceMs` findet die Option im Typ (`:59`), in `run` (`:235`) und sonst nur in `workspace-process-tree.test.ts`. Das ist als Naht sauber dokumentiert und in Ordnung; erwähnenswert nur, weil damit die 5 Sekunden für jeden Produktionspfad fest sind — auch für die 120-Minuten-Claude-Läufe, wo eine längere Frist dem Testlauf mehr Gelegenheit gäbe, seine Kinder selbst einzusammeln.

**Aus früheren Reviews, unverändert:**

- Eine 6-Stunden-Pause kostet weiterhin ~1.080 Weckvorgänge mit je zwei Store-Abfragen; der Hauptschalter als Weckruf hilft bei einem Rate-Limit nicht; ein dauerhaft ausfallender Store blendet den Hauptschalter mit aus (`catch { continue }`); die 20-Sekunden-Lücke der Anzeige bleibt.
- `RunLog.tsx` `load()` weiterhin ohne Fehlerbehandlung — bei einem Fehlschlag bleibt `loading` auf `true`. `HealthOverview.tsx` macht es an derselben Stelle richtig.
- `runRound` listet die Container weiterhin je Repo statt je Runde; der Kommentar sagt „Einmal auflisten".
- `/neustart`-Rückfrage verfällt nie; Entwarnung ohne vorherige Meldung; Prompt-Injection aus fremden Logs; `flock` fehlt im PHP-Wächter; `check.php` trägt die Kennung als URL-Cronjob in die Zugriffslogs.
- Kommentare zum `health-agent` („genau vier Aufrufe", „kein Netzwerk nach außen") weiterhin unzutreffend.
- pg-store-Retention bei jedem Insert; File-Store vergibt Log-IDs nach `clear()` neu; `sampleCache` racy; Memory-Repo-Store-Backfill nur beim Anlegen; Backup-Code-Format weicht vom eigenen Kommentar ab.
- `delivery/health.md:46` sagt weiterhin „bis zu einer Stunde je Paket"; seit `ac2c9b6` sind es zwei.

---

## Was gut ist

Der bug-023-Fix ist sauber gedacht, und drei Dinge daran sind nicht offensichtlich.

**Erstens die Diagnose.** Der Report trennt bug-023 ausdrücklich von bug-018, und die Begründung ist die richtige: „Ein init räumt nur ab, was *beendet* ist; einen lebenden Enkelprozess bringt es nicht um." Das ist genau der Punkt, an dem die naheliegende Erklärung („PID 1 ist doch docker-init, das müsste reichen") kippt, und er ist im Code-Kommentar (`lib/workspace.ts:92-94`) noch einmal so hingeschrieben, dass der nächste Leser nicht in dieselbe Falle läuft. Der Report belegt ihn dazu mit Messwerten statt mit Argumenten: vier PIDs, Startzeit, `ELAPSED`, RSS, und die PPID, die zeigt, dass die Prozesse umgehängt worden waren.

**Zweitens der zweite, ungefragte Fund.** Die eigentliche Aufgabe war „Prozessbaum mitnehmen". Dabei ist aufgefallen, dass ein Enkel, der die geerbte Ausgabe-Pipe hält, `close` zurückhält — und damit das Promise von `run()` **für immer**. Das ist kein Nebenaspekt: `run()` wird von jedem git-Aufruf ohne `timeoutMs` benutzt, und dort hätte ein Lauf ohne jede Zeitgrenze gehangen. Die Abschlussnotiz benennt das offen als „Dazu behoben" statt es unter dem Hauptbefund zu verstecken. Die Lösung (`child.on("exit")` als zweite Naht, dieselbe Frist, Antwort mit dem Exit-Code des Kindes) ist die kleinste, die trägt, und der zugehörige Test (`workspace-process-tree.test.ts:133-149`) prüft beides, was er prüfen muss: dass geantwortet wird **und** dass es der Exit-Code des Kindes ist und nicht ein Timeout.

**Drittens der Prüfstand.** Die Entscheidung, an echten Prozessen zu messen statt eine Naht vor `spawn` zu ziehen, ist hier richtig und im Kopf der Datei begründet: „Der Bug steckte genau in dem, was `spawn` und die Signale tun, und eine Naht davor haette ihn nicht gezeigt." Dass `node` statt `sh` die Kinder treibt — mit dem Rückverweis auf bug-016, weil der Worker-Container keine Shell mitbringt — ist die Art Detail, die man beim Schreiben übersieht und beim Deployen bemerkt. Der Test „der Aufruf laeuft in einer eigenen Prozessgruppe" (`:151-172`) prüft die Voraussetzung aller anderen direkt am Kernel (`process.kill(-pid, 0)`), inklusive der Erklärung, warum das ohne `detached` ESRCH wäre. Und `grandchildScript` deckt mit drei Schaltern (`hold`, `childExits`, `ignoreTerm`) vier verschiedene Bauformen desselben Bugs ab, statt vier Skripte zu duplizieren.

Dazu: Die Abschlussnotiz schreibt unter „Nicht getan — bewusst" hin, was sie nicht getan hat (kein regelmäßiger Neustart, kein Speicherlimit), und begründet es mit dem Bugreport. Das ist genau die Disziplin, die Befund 9 überhaupt sauber diskutierbar macht — ich musste nicht rekonstruieren, ob das Speicherlimit vergessen oder verworfen wurde.

Im Übrigen unverändert solide: `pushFailed()` wird konsequent geprüft, `runTestGate` läuft vor jedem Move nach `done/`, SQL ist überall parametrisiert, `GIT_TERMINAL_PROMPT: "0"` und die Übergabe des Tokens als Einweg-Config statt in der URL (`lib/workspace.ts:408-413`) sind weiterhin richtig gemacht, und die Trennung reine Logik ↔ Naht nach draußen trägt jetzt 1179 Tests ohne Docker, ohne Telegram und ohne KI-Anbieter — in 17 Sekunden.

---

**Empfehlung:** Befund 9 zuerst, obwohl er nicht der schwerste ist — er ist der einzige, der noch offen ist, *während* der zugehörige Bug in `done/` liegt, und der Grund, der ein `mem_limit` verboten hat, ist mit `046b076` entfallen. Ein Folge-Requirement in `ready/` ist hier mehr wert als eine Zeile in diesem Bericht, die in sieben Tagen wiederkehrt. Dann Befund 6: eine Zeile plus ein Parameter, und der Fix gilt für beide Prozesse, die `run()` benutzen, statt für einen. Dann Befund 10 — `npm audit fix` plus `images: { unoptimized: true }`, zusammen eine Viertelstunde, räumt drei High-Findings ab und macht die kritische Bewertung gegenstandslos; dass diese Viertelstunde seit zwei Wochen empfohlen ist und nicht stattgefunden hat, ist das eigentliche Signal. Dann Befund 1: achtes Review, unangetasteter Kern, und dahinter weiterhin ein Neustart-Knopf für fremde prod-Container, der niemanden nach seinem Namen fragt. Befund 3 bleibt der billigste echte Gewinn und ist nach bug-023 nicht mehr nur kosmetisch: Ein Rechner am Speicherlimit soll als Rechner am Speicherlimit im Verlauf stehen, nicht als Netzabbruch. Befunde 7 und 8 sind klein genug, um sie beim nächsten Anfassen von `workspace.ts` mitzunehmen.

**Zusammenfassung:** Ein Durchgang mit genau einer Code-Änderung. bug-023 ist gut gebaut — die Diagnose trennt sauber von bug-018, der Fix findet unterwegs einen zweiten, schwereren Fehler (ein `run()` ohne Zeitgrenze konnte ewig hängen) und behebt ihn mit, und der Prüfstand misst an echten Prozessen, weil eine Naht den Bug nicht gezeigt hätte. Drei Dinge fehlen: Die Verdrahtung, die den Fix im Worker abschließt, fehlt im Web-Prozess, der `run()` genauso benutzt (Befund 6). `killProcessTree` dokumentiert eine Vorbedingung, die sein einziger Produktionsaufrufer nicht erfüllen kann, und sein Rückfallzweig ist auf Linux nur in genau dem Zustand erreichbar, den die Dokumentation ausschließt (Befund 7) — operativ harmlos bei `pid_max` 4194304, aber eine Absicherung, die der nächste Leser für eine hält. Und der Pfad, der die im Report dokumentierten Waisen tatsächlich erzeugt hat — Worker unter Speicherdruck hart abgeschossen —, bleibt ungedeckt, während die Obergrenze, die den Schaden auf appbaua begrenzt hätte, weiterhin an keinem Container steht (Befund 9). Darüber hinaus: **alle sechzehn Vorbefunde des letzten Reviews sind einzeln am heutigen Code nachgeprüft und unverändert offen**, darunter achtmal in Folge die fehlende Authentifizierung (heute gezählt: 3 von 33 Routen) und eine kritische RCE-Bewertung, deren Entschärfung seit zwei Wochen als Zwei-Schritte-Rezept vorliegt. Quality Gate live und vollständig grün: 1179/1179 Tests (+9 übersprungen), Typecheck sauber, Lint unverändert 5 False Positives, `npm audit` unverändert 1 kritisch + 3 high über dieselben vier Pakete. Ich habe nichts committet und nichts gepusht.
