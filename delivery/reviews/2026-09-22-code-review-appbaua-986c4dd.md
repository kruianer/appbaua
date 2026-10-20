---
type: code-review
repo: AppBaua
commit: 986c4dd
date: 2026-09-22
---

# Code-Review: AppBaua (986c4dd)

Automatisch erstellt vom appbaua-Worker am 2026-09-22.

Everything is verified. Here is the full report.

---
type: code-review
repo: appbaua
commit: 986c4dd
date: 2026-09-22
---

# Code-Review appbaua (Branch `dev`, Stand 986c4dd)

Bezug: [delivery/reviews/2026-09-15-code-review-appbaua-8e5dab4.md](delivery/reviews/2026-09-15-code-review-appbaua-8e5dab4.md). Seitdem sind fünf Commits gelandet, davon **genau einer mit Code-Änderung**: `986c4dd` (bug-022, „Eine laufende Pause lässt sich nicht abbrechen"), 91 Zeilen in `lib/worker-loop.ts` und 413 in `lib/worker-loop.test.ts`. Die übrigen vier sind Dokumente: der letzte Review-Bericht, ein Security-Bericht, eine Idee, der Bugreport selbst.

Dieser Durchgang ist deshalb anders geschnitten als der letzte: Das neue Stück Code ist klein genug, um es Zeile für Zeile zu lesen — das habe ich getan und dabei eine Lücke gefunden, die die Abschlussnotiz von bug-022 ausdrücklich als geschlossen bezeichnet. Den Rest des Berichts machen die fünfzehn Vorbefunde aus, die ich einzeln am heutigen Code nachgeprüft habe, statt sie zu übernehmen. **Alle fünfzehn sind unverändert offen.**

**Quality Gate (live gefahren):** `NODE_ENV=test npx vitest run` → **1169/1169 grün**, 9 übersprungen, 75 Testdateien (die 9 sind weiterhin die PHP-Tests des Wächters). `npm run typecheck` sauber. `npm run lint` unverändert exakt dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157). `npm audit` unverändert **1 kritisch + 3 high**.

*Zur Umgebung:* Anders als die Notiz „keine Shell im Worker-Container" nahelegt, ließ sich das Gate hier vollständig ausführen — Tests, Typecheck, Lint und Audit sind gemessen, nicht geschätzt.

---

## Kritisch

### 1. Middleware prüft weiterhin nur „Cookie vorhanden" — siebtes Review in Folge
`middleware.ts:38` unverändert: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`, sonst nichts. Die im Kommentar darüber versprochene zweite Prüfung existiert nach wie vor in **3 von 33** `route.ts`-Dateien. `app/page.tsx:10-14` lädt weiterhin ungeprüft Repos, Task-Typen und Worker-State.

Am heutigen Code nachgesehen, unverändert: `app/api/health/restart/route.ts` startet ab Zeile 7 einen fremden prod-Container neu — die einzige Prüfung im Handler ist `typeof body.repoId !== "string"`. Wer der Anfragende ist, wird nirgends gefragt; `restartAppContainer` prüft sorgfältig, dass der Container zur App gehört, aber nicht, wer fragt. Dazu unverändert `app/api/health/analyze` (gibt Geld beim KI-Anbieter der fremden App aus, ohne Rate-Limit), `app/api/health/settings` und `app/api/repos/[id]/monitored` (schalten die Überwachung stumm), `app/api/repos/*` (inkl. Push mit dem gespeicherten PAT), `app/api/worker-state/*`, `app/api/task-types/*`. Beide Umgebungen stehen laut `delivery/devops.md` über je einen Cloudflare-Tunnel im Internet.

**Fix:** unverändert — `userIdForSession`/`currentUser` in einen gemeinsamen Wrapper, über jede nicht-öffentliche Route. Bei sieben Wiederholungen ist das kein Backlog-Punkt mehr, sondern eine Entscheidung, die getroffen und nicht getroffen wird.

### 2. Die geretteten Etappen werden beim nächsten Lauf weiterhin vernichtet
**Unverändert seit dem letzten Review.** Nachgeprüft: `checkoutTracking` (`lib/workspace.ts:314-328`) endet weiterhin mit

```
git checkout -B <branch> origin/<branch>
git reset --hard origin/<branch>
```

und wird weiterhin von `prepareRepo` aus aufgerufen (`lib/workspace.ts:391`, `423`), also zu Beginn **jedes** Schritts. `reset --hard` **mit Ziel** wirft lokale Commits weg, die das Remote nicht hat — exakt die Etappen, die `keepStages`/`pushStages` gerettet haben, wenn deren Push scheiterte. Der Kommentar bei `discardChanges` (`lib/workspace.ts:539`) argumentiert weiterhin korrekt über `reset --hard` **ohne** Ziel und deckt damit den anderen Fall nicht ab.

Das bleibt der teuerste offene Punkt nach Befund 1: Es wurden zwei Commits und ein Docker-Volume dafür ausgegeben, Etappen zu retten, und der eigentliche Vernichter ist weiterhin unangetastet. Der Fix aus dem letzten Review gilt unverändert.

### 3. Zwei Netzwerk-Erkennungen widersprechen sich weiterhin
**Unverändert.** `grep -n errorKindOf lib/network-abort.ts` → **kein Treffer**. `isNetworkAbort` (`lib/network-abort.ts:70`) prüft weiterhin nur `isClaudeTimeout` und läuft danach über eine eigene Wortlaut-Liste, ohne die in `lib/error-kind.ts` sorgfältig begründete Reihenfolge („Testsuite vor Netzwerk", Kategorie „Rechner am Limit"). Ein Container, der nicht mehr forken kann, wird damit weiterhin als Netzstörung behandelt und legt dreimal den kompletten Pass still. Fix bleibt der Einzeiler: `isNetworkAbort` auf `errorKindOf(text) === "network"` zurückführen.

Nebenbei: `lib/network-abort.ts:55` sagt weiterhin „60 minutes", seit `ac2c9b6` sind es 120.

### 4. Der Doku- und der recurring-Task committen weiterhin fremde Änderungen
**Unverändert.** `discardChanges` steht in `lib/execute-step.ts` an den Zeilen 266 (`keepStages`), 576 (idea), 593 (security) und 816 (`parkFailed`). Der `doc`-Zweig (Push bei 624) und der recurring-/file-Zweig rufen es weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht und seit req-036 alle lokalen Commits mitpusht, landet unter „worker: Doku aktualisiert" weiterhin alles, was der Lauf sonst angefasst hat.

### 5. Der abgelegte Bericht geht weiterhin unredigiert ins Repo
**Unverändert.** `grep -c redact lib/execute-step.ts` → weiterhin **0**. `fileReport` schreibt `report` unverändert ins Repo — auch dieses Dokument hier nimmt diesen Weg. Jedes andere neue Modul macht es an der vergleichbaren Stelle richtig.

---

## Wichtig

### 6. NEU: bug-022 — eine vom Menschen gesetzte Pause wird sehr wohl überschrieben, und der Test, der das ausschließen soll, hält den Gegenbeweis selbst fest
Das ist der einzige neue Code dieses Durchgangs, und er ist überwiegend gut gemacht (siehe „Was gut ist"). Eine der vier Zusicherungen der Abschlussnotiz trägt aber nicht.

`delivery/bugs/done/bug-022-…md:104` sagt:

> **Eine Pause, die ein Mensch gesetzt hat, wird nicht überschrieben.** Der abschließende `setPauseUntil(null)` passiert nur, wenn das gespeicherte Fenster noch das eigene ist.

Der zweite Satz stimmt. Der erste folgt nicht aus ihm. Nachvollzogen an `lib/worker-loop.ts:392-413`:

1. Ein Mensch trägt ein eigenes Fenster in `pause_until` ein — der Weg, den bug-022 selbst als Bedienoberfläche beschreibt („`pause_until` in der Datenbank auf NULL setzen", Steps 2).
2. `sleepThroughPause` sieht beim nächsten Abschnitt eine Abweichung, gibt `false` zurück, und der Aufrufer überspringt korrekt das `setPauseUntil(null)`.
3. Dann aber: `continue` → `runOnce` läuft **sofort** wieder. Und **nichts in `runOnce` liest `pause_until`** — nachgeprüft mit `grep -rn pauseUntil lib/ app/api/`: die einzigen Leser sind `lib/dashboard.ts:53` (Anzeige) und die neue `getPauseUntil`-Naht. Das Fenster des Menschen hält den Worker also keine Sekunde auf.
4. Der nächste Pass schreibt dann sein eigenes Fenster darüber — entweder `setPauseUntil(until, …)` in Zeile 401, wenn wieder ein Rate-Limit/Auth-Fehler kommt, oder **bedingungslos** `setPauseUntil(new Date(untilMs).toISOString())` in Zeile **411**, sobald ein Pass nichts geschafft hat. Zeile 411 prüft nicht, was gespeichert ist. Das Fenster des Menschen ist damit nach spätestens einem Pass weg.

Der Beweis steht im eigenen Test. `lib/worker-loop.test.ts:591` heißt „eine vom Menschen gesetzte Pause überschreibt der Worker nicht", der Mensch setzt dort ein 30-Minuten-Fenster (Zeile 601), und der Worker schreibt danach sein eigenes 6-Stunden-Fenster. Die Zusicherung lautet:

```ts
expect(rig.pauseArgs.map((a) => a.iso === null)).toEqual([false, false]);
```

Geprüft wird ausschließlich, dass der Worker nie `null` geschrieben hat. Der zweite Eintrag in `pauseArgs` **ist** das Überschreiben — der Test sammelt es ein und schaut daran vorbei. Ein Test, der das Gegenteil seines Namens belegt, ist unangenehmer als eine Lücke ohne Test: Er wird beim nächsten Lesen als Absicherung gezählt.

Die Wirkung ist genau die Bauform, gegen die bug-022 angetreten ist, nur seitenverkehrt: vorher schlief der Worker, während die Anzeige „nichts zu tun" sagte; jetzt arbeitet er, während die Anzeige „Pause bis HH:MM" sagt.

**Fix:** zu entscheiden, was `pause_until` sein soll. Wenn es wirklich die QUELLE der Pause ist (so die Notiz), dann muss `runForever` ein fremdes, noch in der Zukunft liegendes Fenster am Pass-Anfang respektieren und Zeile 411 darf es nicht bedingungslos überschreiben. Wenn es nur für die eigenen Pausen des Workers die Quelle ist, gehört der Satz in der `.md` korrigiert und der Test umbenannt auf das, was er prüft („der Worker räumt ein fremdes Fenster nicht weg"). Beides ist vertretbar; der heutige Zwischenstand ist es nicht, weil er eine Zusicherung dokumentiert, die der eigene Test widerlegt.

### 7. `npm audit`: unverändert 1 kritisch + 3 high — und zwei Teile davon sind seit einer Woche mit einem Befehl behebbar
Live gemessen bei `next@^15.5.21`, identisch zum letzten Review:

```
next     9.3.4-canary.0 - 16.3.0-preview.10   critical (2× unauth. RCE)
nanoid   <3.3.18        high
postcss  <=8.5.22       high  (4 Advisories)
sharp    <=0.35.4-rc.0  high
```

Der letzte Bericht hat den Weg hier bereits vollständig aufgeschrieben: (a) `npm audit fix` hebt nanoid/sharp/postcss innerhalb der bestehenden Ranges — kostet nichts, bricht nichts; (b) `images: { unoptimized: true }` in `next.config.ts` schaltet den verwundbaren Image-Optimizer ab, den diese App nirgends benutzt, und macht die kritische Bewertung gegenstandslos, ohne auf `next@16` zu warten.

Nachgeprüft: `next.config.ts` hat unverändert **keinen** `images`-Block. Beides ist zusammen eine Viertelstunde und ist in der Woche seit der Empfehlung nicht passiert. Die Windows-RCE trifft weiterhin nicht zu (Alpine); die AVIF-RCE sitzt weiterhin im Optimizer, und `/_next/image` ist weiterhin der eine Serverpfad, den der Middleware-Matcher (`middleware.ts:54`) ausdrücklich ausnimmt.

### 8. `lib/acceptance-criteria.ts` ist weiterhin toter Code
**Unverändert.** `grep -rn "acceptance-criteria" --include=*.ts --include=*.tsx .` außerhalb der eigenen Testdatei → **kein einziger Treffer**. 102 Zeilen, sechs exportierte Funktionen, **14 Tests, die in diesem Lauf grün liefen** — über Code, der in der Produktion nie aufgerufen wird. Der Etappen-Mechanismus von req-036 hängt weiterhin vollständig an der Prosa in `fileTaskPrompt`. Entweder einhängen (dann prüft der Worker vor dem Move nach `done/` wirklich die Häkchen, das wäre AC 6) oder samt Tests entfernen und im Requirement festhalten, dass die Etappen prompt-getrieben sind.

### 9. Beim Timeout wandert die `.md` weiterhin nach `failed/` — AC 4 von req-036 bleibt unerfüllt
**Unverändert.** `lib/network-abort.ts:70` schließt den Timeout weiterhin ausdrücklich aus (`if (!text || isClaudeTimeout(text)) return false`), also fällt er in den gewöhnlichen Fehlerzweig: `lib/execute-step.ts:554` `keepStages`, dann 559 `parkFailed`. Ergebnis unverändert: halbfertige Arbeit auf `dev`, Paket in `failed/`, kein Durchlauf nimmt es wieder auf.

### 10. `parkFailed` pusht weiterhin fremde Commits
**Unverändert.** `lib/execute-step.ts:816` ruft weiterhin `discardChanges` (das Commits stehenlässt) und danach `commitAndPush` (das alle lokalen Commits mitschiebt), während der Kommentar darüber weiterhin „the commit carries the move and nothing else" verspricht. Der unangenehmste Weg bleibt das rote Test-Gate bei Zeile 665: `parkFailed` ohne vorheriges `keepStages` — der Zweig, der einen roten Stand nicht durchlassen soll, pusht ihn.

### 11. Der `health-agent` vertraut seinem Netz weiterhin vollständig
**Unverändert.** `grep -n "TOKEN\|timingSafeEqual\|authoriz\|secret" agent/*.ts` → **kein Treffer**. Jeder Prozess im Compose-Netz kann weiterhin `GET /containers/<id>/env?name=…`, `POST /containers/<id>/restart` und `GET /containers/<id>/logs`.

### 12. `psql` in der Erlaubnisliste ist weiterhin faktisch beliebige Befehlsausführung
**Unverändert.** `lib/docker.ts:36-44`: `ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"]`, und `isAllowedCommand` prüft weiterhin ausschließlich `cmd[0]`. `psql -c '\! …'` und `COPY … FROM PROGRAM …` bleiben erreichbar. Der Kommentar darüber behauptet weiterhin, alles andere wäre „beliebige Befehlsausführung als root" — als sei `psql` das nicht.

### 13. Die Web-Prüfung wertet „konnte nicht geprüft werden" weiterhin als Rot
**Unverändert.** `lib/health-checks.ts:197-200`: jeder Fehler aus `fetchImpl` setzt `failed = true`, und der Text sagt „keine Antwort". Nach zwei Runden meldet Telegram — pro überwachter App, mitten in der Nacht, über Apps, denen nichts fehlt.

### 14. Geheimnisse sollen laut Doku nach `deploy/*.env` — einen Pfad, den der Deploy nie liest
**Unverändert.** `delivery/devops.md` weist weiterhin an vier Stellen (24, 54, 80, 117) auf `deploy/dev.env` / `deploy/prod.env`; `.github/workflows/deploy.yml:50,53` liest ausschließlich `$HOME/appbaua-env/{dev,prod}.env`. Der Kopf der `docker-compose.yml` (Zeilen 4–5) nennt weiterhin den toten Pfad, während Zeile 106 derselben Datei schon `~/appbaua-env/*.env` sagt. `grep -n deploy .gitignore` → **kein Treffer**: Wer der Anleitung folgt, legt Geheimnisse in einem nicht ignorierten Verzeichnis ab und bekommt keine Fehlermeldung, sondern Stille.

### 15. Der PHP-Ausfallwächter wird weiterhin faktisch ungetestet ausgeliefert
**Unverändert, live bestätigt:** `watchdog/watchdog.test.ts (14 tests | 9 skipped)` in diesem Lauf. Token-Prüfung, Alarm nach Frist, genau eine Nachricht, Entwarnung — nichts davon läuft in einem nachweisbaren Lauf.

### 16. Weitere Vorbefunde, am heutigen Code nachgeprüft und unverändert offen
- **Container laufen in UTC.** `grep -c TZ docker-compose.yml Dockerfile*` → **0** in allen vier Dateien. Zeitfenster der Task-Typen bleiben 1–2 h gegen deutsche Ortszeit verschoben.
- **Kein `mem_limit` auf irgendeinem Container.** `grep -c mem_limit docker-compose.yml` → **0**, inklusive des Workers mit 120-Minuten-Läufen.
- **`WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS`** (`grep -n WATCHDOG_TOKEN lib/redact.ts` → kein Treffer).
- **„Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster** (`lib/worker-loop.ts:195`).
- **`NODE_ENV=production` leckt weiterhin in Claudes Kindprozesse**; `lib/test-gate.ts` macht es für das offizielle Gate richtig.
- **Lost-Update-Race in allen Blob-Mutationen** — `repo-service`, `task-service`, die Health-Blobs, `createPgNetworkAbortStore`.
- **Auth-Bootstrap: TOCTOU** (`lib/auth-bootstrap.ts`), `countUsers()`/`createUser()` weiterhin nicht transaktional.
- **`diagnostics` bleibt eine Spalte ohne Produzenten**; **req-036/037 liegen weiterhin mit 0 gesetzten Häkchen in `done/`**, und `delivery/requirements/ready/` enthält weiterhin kein Folge-Requirement für die dort selbst benannten offenen Kriterien.
- **bug-021: `overflowX: "clip"` weiterhin ohne Umbruchregel in `TaskControl.tsx`**; die kaputte Einrückung in vier Komponenten ebenso.
- **`serviceBlockLocal` in `docker-compose.test.ts:152` weiterhin ungenutzt**; das `worker-work`-Volume wächst weiterhin unbegrenzt; der Netzabbruch-Zähler wird weiterhin nie aufgeräumt.
- **`next lint` ist deprecated** — die Warnung steht bei jedem Lauf im Log, und die Migration gehört ohnehin zu Befund 7.

---

## Kleinere Punkte

**Neu, aus bug-022:**

- **Eine 6-Stunden-Pause kostet jetzt ~1.080 Weckvorgänge mit je zwei Store-Abfragen** (`getPauseUntil` + `isEnabled`, `lib/worker-loop.ts:328-345`) — rund 2.160 Postgres-Queries, wo vorher eine einzige `sleep` stand. Betrieblich ist das auf einem Mini-PC folgenlos, und 20 Sekunden sind die richtige Wahl für die Bedienbarkeit. Erwähnenswert nur, weil `PAUSE_POLL_MS` als Konstante exportiert ist und man beim Verkleinern wissen sollte, was linear mitwächst.
- **Der Hauptschalter als Weckruf hilft bei einem Rate-Limit nicht.** Aus und wieder an beendet die Pause (so gewollt, bug-022), aber der nächste Pass läuft in dasselbe Rate-Limit, schreibt eine weitere „idle"-Zeile in den Verlauf und pausiert erneut bis zum selben Zeitpunkt. Der Knopf verspricht dort mehr, als er einlösen kann.
- **Ein Store, der dauerhaft ausfällt, blendet den Hauptschalter mit aus.** `catch { continue }` (`lib/worker-loop.ts:337`) überspringt den `isEnabled`-Zweig komplett. Für die Pausendauer ist das richtig entschieden („unlesbar gilt als unverändert"), für den Schalter ist es eine stille Nebenwirkung, die kein Kommentar erwähnt.
- **Die 20-Sekunden-Lücke der Anzeige bleibt.** Zwischen dem Leeren von `pause_until` und dem Aufwachen zeigt die Startseite weiterhin „Leerlauf — nichts zu tun" — das Originalsymptom von bug-022, nur auf höchstens einen Abschnitt verkürzt. Das ist die richtige Abwägung; sie steht nur nirgends, und der nächste Leser hält es sonst für einen Rückfall.

**Aus früheren Reviews, unverändert:**

- `RunLog.tsx` `load()` weiterhin ohne Fehlerbehandlung — bei einem Fehlschlag bleibt `loading` auf `true`. `HealthOverview.tsx` macht es an derselben Stelle richtig.
- `runRound` listet die Container weiterhin je Repo statt je Runde; der Kommentar sagt „Einmal auflisten".
- `/neustart`-Rückfrage verfällt nie; Entwarnung ohne vorherige Meldung; Prompt-Injection aus fremden Logs; `flock` fehlt im PHP-Wächter; `check.php` trägt die Kennung als URL-Cronjob in die Zugriffslogs.
- Kommentare zum `health-agent` („genau vier Aufrufe", „kein Netzwerk nach außen") weiterhin unzutreffend.
- pg-store-Retention bei jedem Insert; File-Store vergibt Log-IDs nach `clear()` neu; `sampleCache` racy; Memory-Repo-Store-Backfill nur beim Anlegen; Backup-Code-Format weicht vom eigenen Kommentar ab.
- `delivery/health.md:46` sagt weiterhin „bis zu einer Stunde je Paket"; seit `ac2c9b6` sind es zwei.

---

## Was gut ist

Der bug-022-Fix ist handwerklich das Beste, was der Worker in diesem Repo bisher selbst abgeliefert hat, und das sollte nicht unter Befund 6 verschwinden.

Drei Entscheidungen darin sind nicht offensichtlich und trotzdem richtig getroffen. Erstens der **Vergleich als Zeitpunkt statt als Text** (`isOwnPause`, `lib/worker-loop.ts:313`): Der Kommentar begründet es mit dem Weg durch Postgres, und das ist keine theoretische Sorge — ich habe die Kette nachgesehen, `pause_until` ist `TIMESTAMPTZ` (`lib/schema.sql:99`) und `createPgWorkerStatusStore` normalisiert beim Lesen über `new Date(d).toISOString()` (`lib/pg-store.ts:386`). Ein Textvergleich hätte hier funktioniert und wäre trotzdem die falsche Zusicherung gewesen; die Sekunde Toleranz ist großzügig genug für jede Formatierung und eng genug, um keinen menschlichen Eingriff zu verschlucken. Zweitens **„unlesbar gilt als unverändert"**: Ein DB-Aussetzer kürzt die Pause nicht ab, sondern der nächste Abschnitt sieht erneut nach. Das ist die Richtung, in die ein Zweifelsfall fallen soll, und sie ist mit einem eigenen Test belegt (`worker-loop.test.ts:565`), der den Store zweimal werfen lässt und danach die volle Fensterlänge einfordert. Drittens die **Unterscheidung „nur aus" vs. „aus und wieder an"** über `sawDisabled`: Ein ausgeschalteter Worker soll nicht aufwachen, ein wieder eingeschalteter schon — das ist genau die Lesart, die der Bugreport verlangt, und sie steht in vier Zeilen ohne Zustandsmaschine daneben.

Bemerkenswerter noch ist der **Prüfstand**. `pauseRig` (`worker-loop.test.ts:80-115`) lässt die Uhr mit jedem Abschnitt weiterlaufen und leitet das Pausenfenster durch den **echten** Worker-Status-Store — denselben Wert, den ein Mensch in der Datenbank ändert. Der Test zur Anzeige (Zeile 516) ruft an jedem Punkt des Schlafs `derivePhase` auf und fordert `["pause","pause","pause"]`: Damit ist die zweite Hälfte des Bugs — die falsche Meldung — nicht durch ein Argument abgedeckt, sondern durch eine Messung an der Funktion, die die Startseite wirklich benutzt. Und die Gegenprobe im Commit-Text („mit dem alten langen Schlaf fallen fünf der sechs um, darunter die Anzeige") ist genau das reproduce-first, das `delivery/stack.md` verlangt — nachgewiesen statt behauptet. Dass Befund 6 überhaupt so präzise formulierbar ist, verdankt sich diesem Prüfstand: Der Test sammelt das Überschreiben bereits ein, er schaut nur an der falschen Eigenschaft vorbei.

Im Übrigen unverändert solide: `pushFailed()` wird konsequent geprüft, `runTestGate` läuft vor jedem Move nach `done/`, SQL ist überall parametrisiert, und die Trennung reine Logik ↔ Naht nach draußen trägt jetzt 1169 Tests ohne Docker, ohne Telegram und ohne KI-Anbieter — in 25 Sekunden.

---

**Empfehlung:** Befund 7 zuerst, obwohl er nicht der schwerste ist — `npm audit fix` plus eine Zeile `images: { unoptimized: true }` sind zusammen eine Viertelstunde, räumen drei High-Findings ab und machen die kritische Bewertung gegenstandslos. Dass diese Viertelstunde seit einer Woche empfohlen ist und nicht stattgefunden hat, ist das eigentliche Signal. Dann Befund 1: siebtes Review, unangetasteter Kern, und dahinter steht weiterhin ein Neustart-Knopf für fremde prod-Container, der niemanden nach seinem Namen fragt. Dann Befund 2, weil jeder Rebase-Konflikt weiterhin genau die Arbeit kostet, die req-036 sichern sollte — und der Kommentar im Code dem nächsten Leser sagt, es sei versorgt. Befund 3 bleibt der billigste echte Gewinn (ein Einzeiler). Befund 6 ist klein genug, um ihn beim nächsten Anfassen von `worker-loop.ts` mitzunehmen; wichtig ist dabei nicht die Codezeile, sondern dass `.md` und Testname danach dasselbe sagen wie der Code.

**Zusammenfassung:** Ein Durchgang mit genau einer Code-Änderung. bug-022 ist gut gebaut — geschnittener Schlaf, Vergleich als Zeitpunkt, Lesefehler kürzt nicht, Hauptschalter mitgelesen, und ein Prüfstand, der die Pause wirklich durchlebt statt sie zu simulieren. Eine der vier Zusicherungen der Abschlussnotiz trägt nicht: `pause_until` ist die Quelle nur für die eigenen Pausen des Workers; ein vom Menschen gesetztes Fenster hält ihn keine Sekunde auf und wird vom nächsten Pass bedingungslos überschrieben — nachweisbar an den Daten, die der zugehörige Test selbst einsammelt und nicht prüft. Darüber hinaus: **alle fünfzehn Vorbefunde des letzten Reviews sind einzeln am heutigen Code nachgeprüft und unverändert offen**, darunter siebenmal in Folge die fehlende Authentifizierung und eine kritische RCE-Bewertung, deren Entschärfung seit einer Woche als Zwei-Schritte-Rezept vorliegt. Quality Gate live und vollständig grün: 1169/1169 Tests (+9 übersprungen), Typecheck sauber, Lint unverändert 5 False Positives. Ich habe nichts committet und nichts gepusht.
