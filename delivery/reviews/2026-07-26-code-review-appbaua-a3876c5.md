---
type: code-review
repo: AppBaua
commit: a3876c5
date: 2026-07-26
---

# Code-Review: AppBaua (a3876c5)

Automatisch erstellt vom appbaua-Worker am 2026-07-26.

Review abgeschlossen. Vorab dieselbe Einschränkung wie beim letzten Lauf, transparent gemacht: **in diesem Container steht keine Shell zur Verfügung** (`No suitable shell found`), also konnten `npm test`, `npm run lint` und `npm run typecheck` nicht ausgeführt werden. Die Review beruht auf Quelltextanalyse (alle `lib/`, `app/api/`, `components/`, `worker/`, Docker-/CI-Dateien, `delivery/*.md`, dazu die Tests). Nichts committet, nichts gepusht.

---

# Code-Review appbaua (Branch `dev`, Stand a3876c5)

Bezug: [delivery/reviews/review-2026-07-25-dev-282a765.md](delivery/reviews/review-2026-07-25-dev-282a765.md). Von den dortigen Befunden sind 1, 2, 4, 5, 7 und 9 erledigt (bug-002 bis bug-005) — die Fixes sind sauber und an der richtigen Stelle. Noch offen sind 3, 6, 8 und die meisten Kleinigkeiten; sie stehen unten kurz wieder drin, damit dieser Bericht für sich allein steht.

## Kritisch

### 1. Ein fehlgeschlagener Push wird als „Erfolg" gemeldet
`lib/execute-step.ts:235-243` nimmt das Ergebnis von `commitAndPush` entgegen und verwendet es **nur für den Meldungstext** — `push.pushed` wird nie geprüft. Dasselbe im Ideen-Zweig (`lib/execute-step.ts:205-213`). Scheitert der Push (non-fast-forward, Token abgelaufen, Netz weg), liefert der Schritt trotzdem `{ kind: "success" }`. `lib/execute-step.test.ts:850-866` zementiert das sogar als Erwartung („a push that fails is reported in the log message" → `expect(d.kind).toBe("success")`).

Folgen, je nach Task-Typ:

- **Datei-getrieben (Bug/Requirement):** Die `.md` liegt lokal in `done/`, aber nichts davon ist auf `dev`. Der nächste `prepareRepo` macht `reset --hard origin/dev` (`lib/workspace.ts:186`) — `ready/x.md` ist wieder da, die geleistete Arbeit ist weg. Die Aufgabe wird erneut ausgeführt, wieder mit bis zu 60 Minuten Claude-Lauf. Und weil `succeeded` hochgezählt wird (`lib/worker-loop.ts:140`), **pausiert die Schleife nicht** — es ist exakt die Heißlauf-Situation aus bug-002, nur durch eine andere Tür.
- **Wiederkehrend (Code-Review/Doku):** Der Bericht ist geschrieben, aber nicht gepusht. Der Log-Eintrag steht auf `success`, also greift `ranTodayForRepo` (`lib/task-source.ts:102`) und der Task läuft heute nicht mehr. Der Bericht ist ersatzlos verloren — genau das, was req-010 verhindern sollte.
- **Ideen:** Die vorgeschlagene Idee ist verloren und der Tag ist verbraucht.

Der Log sagt in allen drei Fällen „Erfolg", enthält aber im Text „push failed: …". Das unterläuft das Vision-Prinzip „Nachvollziehbarkeit" direkt.

**Fix:** Dasselbe Muster verwenden, das `lib/appbaua-standard.ts:243` bereits richtig macht:

```ts
if (!push.pushed && push.detail !== NO_CHANGES_DETAIL) {
  return { kind: "error", message: `${outcome.summary} — nicht gepusht: ${push.detail}` };
}
```

Bei datei-getriebenen Tasks sollte dann zusätzlich `parkFailed` greifen, damit die `.md` nicht endlos wiederholt wird. Der Test in `execute-step.test.ts:850` ist mitzudrehen.

### 2. Die Container laufen in UTC, die Zeitfenster werden lokal ausgewertet
`lib/scheduling.ts:22-24` (`minutesOfDay` → `now.getHours()`), `weekdayOf` (`:16`) und `lib/task-source.ts:108-115` (`ranTodayForRepo`) rechnen alle in der **lokalen Zeit des Prozesses**. In `docker-compose.yml` ist für weder `app` noch `worker` eine `TZ` gesetzt, und `node:22-alpine` bringt keine Zeitzonendaten mit — beide Container laufen also in **UTC**. Der Nutzer stellt die Fenster dagegen in der Weboberfläche über `<input type="time">` (`components/TaskControl.tsx:445-473`) ein und liest sie als deutsche Ortszeit.

Ergebnis: Jedes konfigurierte Fenster ist im Betrieb um 1–2 Stunden verschoben. Ein Nachtfenster „22:00–06:00" (der Fall, für den bug-004 überhaupt gebaut wurde) läuft im Sommer tatsächlich von 00:00 bis 08:00 deutscher Zeit. Ebenso verschiebt sich die Tagesgrenze für „einmal pro Kalendertag": der Ideen-/Review-Tag beginnt um 02:00 Ortszeit. Auch `startOfTodayIso` (`lib/dashboard.ts:33`) und damit die Kachel „Heute" hängen daran.

Das ist kein Randfall — die Vision nennt die Zeitfenster ausdrücklich als Mittel, die Rate-Limits nachts zu schonen, und für den Nutzer sieht es aus wie „der Worker hält sich nicht an die Einstellungen".

**Fix:** `TZ: Europe/Berlin` (bzw. konfigurierbar) in beiden Services setzen **und** `tzdata` in beide Images aufnehmen (`apk add --no-cache tzdata`) — ohne das ignoriert Alpine `TZ` stillschweigend und bleibt bei UTC. Ein Test, der `isTaskDue` gegen eine feste Zone prüft, hält das fest.

### 3. Ein erfolgreicher Analyse-Task committet alles, was Claude im Repo verändert hat
Beim wiederkehrenden Typ schreibt `lib/execute-step.ts:226-235` den Bericht und ruft direkt `commitAndPush` — und das macht `git add -A` (`lib/workspace.ts:221`). Vorher wird **nichts verworfen**. `recurringPrompt` (`lib/claude-runner.ts:108-116`) sagt nur „Committe/pushe NICHT selbst", nicht „ändere nichts". Claude läuft mit `--dangerously-skip-permissions` und darf schreiben.

Ein Code-Review, das unterwegs eine Datei anfasst (eine Notiz ablegt, einen „kleinen Fix nebenbei" macht, ein Tool eine Datei umschreiben lässt), pusht diese Änderung also unter der Commit-Nachricht `worker: Code-Review durchgeführt` auf `dev` — ungeprüft und nicht als Codeänderung erkennbar. Von dort geht sie im nächsten Promotion-PR mit nach prod. req-010 sagt ausdrücklich, dass diese Tasks „keinen Code ändern"; die Vision verbietet Scope-Ausweitung und das Umgehen von Quality Gates.

Der Ideen-Zweig macht es richtig: `lib/execute-step.ts:202` verwirft, was nicht zur Idee gehört. Der Analyse-Zweig hat dieses Gegenstück nicht.

**Fix:** Vor `fileReport` ein `discardChanges(dir)` (dann trägt der Commit nur den Bericht), und in `recurringPrompt` denselben Satz aufnehmen, den `ideaPrompt` schon hat: „Ändere nichts im Repo — kein Code, keine Dateien."

---

## Wichtig

### 4. Der abgelegte Bericht geht ungefiltert ins Repo — die Redaction aus bug-003 greift dort nicht
`redact` sitzt konsequent vor allem, was flüchtig ist: die Log-Nachricht (`lib/worker-loop.ts:136`), der Live-Tail (`lib/worker-status.ts:155`), git-Ausgaben (`lib/workspace.ts:165,172,228,235`). Der Bericht ist der einzige Pfad, auf dem Claude-Ausgabe **dauerhaft** das Repo erreicht — und genau dort fehlt sie: `runClaude` liefert `report: full` unredigiert (`lib/claude-runner.ts:221-223`), `fileReport` (`lib/execute-step.ts:295-319`) reicht das unverändert an `reportContent`/`writeRepoFile` weiter, und `commitAndPush` schiebt es auf `dev`.

Echoed ein Werkzeug im Review-Lauf einen Token (`env`, ein `git`-Fehler, ein Log-Auszug), und Claude zitiert ihn im Bericht, liegt das Secret danach **unwiderruflich in der Git-Historie** eines Repos — schlimmer als im Log, das eine Retention hat und löschbar ist.

**Fix:** `report` genauso behandeln wie `summary`: `redact(report)` in `fileReport` (oder gleich in `runClaude`, dann ist die Regel „alles, was `runClaude` verlässt, ist gefiltert" lückenlos).

### 5. Die Prozessausgabe wird unbegrenzt im Speicher gesammelt *(offen aus dem letzten Review)*
`lib/workspace.ts:74-83` konkateniert jeden Chunk in `stdout`/`stderr`. Der Claude-Lauf läuft jetzt mit `--output-format stream-json --verbose` (`lib/claude-runner.ts:190-196`) — das ist deutlich mehr Ausgabe als vorher: **jedes** Tool-Ergebnis inklusive gelesener Dateiinhalte kommt als JSON-Zeile. Über bis zu 60 Minuten sind das leicht hunderte MB in einem einzigen String. Verwendet wird davon nur der letzte `result`-Event (`finalResultText`, `lib/claude-events.ts:165`) — der dafür den kompletten Puffer nochmal per `split("\n")` verdoppelt.

Der Live-Tail ist sauber begrenzt (`createLiveTail`, `lib/claude-runner.ts:62`); die Vollpuffer sind es nicht. Für den Worker-Container ist kein Memory-Limit gesetzt, ein OOM trifft also den Host.

**Fix:** In `run()` einen Ringpuffer der letzten N kB halten. Für `stdout` reicht sogar weniger: `finalResultText` braucht nur die letzte `result`-Zeile — die ließe sich beim Streamen mitschneiden, statt alles aufzuheben.

### 6. „Einmal pro Tag" hängt an einem 500-Einträge-Fenster, nicht am Tag
`lib/worker-loop.ts:113` holt `log.list(0, 500)` und übergibt das an `executeStep`, wo `ranTodayForRepo` daraus ableitet, ob ein wiederkehrender Task heute schon lief. Fällt der Erfolgs-Eintrag aus diesem Fenster, läuft der Task erneut.

Das passiert nicht theoretisch: Ein dauerhaft fehlschlagender Schritt (Repo nicht klonbar, Claude-CLI weg) schreibt alle 5 Minuten einen Fehler — bei 2 Repos × 5 Typen sind das ~2.900 Einträge/Tag, das 500er-Fenster deckt dann noch keine zwei Stunden ab. Ein Code-Review vom Morgen wird nachmittags nochmal gefahren, ein zweiter Ideen-Vorschlag entsteht am selben Tag (was `ideaPrompt` ausdrücklich ausschließen soll).

**Fix:** Die Frage „lief das heute schon erfolgreich?" gehört in den Store (analog zu `metricsSince`), nicht in einen abgeschnittenen Listenausschnitt. Nebenbei fällt damit die Abfrage von 500 Zeilen **pro Schritt** weg.

### 7. `push` ohne vorheriges Rebase *(offen aus dem letzten Review)*
`lib/workspace.ts:230` pusht ohne `pull --rebase`. Der `reset --hard` liegt bis zu 60 Minuten zurück; pusht in der Zwischenzeit irgendwer auf `dev` — der Nutzer, oder der Worker selbst aus einem anderen Repo-Schritt heraus, oder die Ideen-Task —, scheitert der Push. Zusammen mit Befund 1 ist das der wahrscheinlichste Weg in den Heißlauf.

**Fix:** `git pull --rebase origin dev` vor dem Push, mit `authEnv(token)`.

### 8. Weiterhin keinerlei Authentifizierung *(offen aus dem letzten Review)*
Es gibt keine `middleware.ts` und keine Prüfung in irgendeiner Route. Solange Phase 1 gilt (nur WLAN, `delivery/deploy-setup.md:21`), ist das kein akutes Risiko — aber die Angriffsfläche ist seit dem letzten Review **größer** geworden: `POST /api/repos/[id]/appbaua` (`app/api/repos/[id]/appbaua/route.ts`) schreibt jetzt unauthentifiziert Commits in beliebige Repos, auf die der PAT Schreibrechte hat. Dazu unverändert: `POST /api/repos` trägt jedes öffentliche Repo ein, das der Worker dann klont und mit `--dangerously-skip-permissions` als Anweisungsquelle liest; `GET /api/github-repos` gibt die vollständige Repo-Liste des PAT heraus.

**Vor Phase 2 (Cloudflare Tunnel, `deploy-setup.md:146`) muss das gelöst sein.** Minimum: Auth vor die App (Cloudflare Access o. ä.) plus eine Allowlist erlaubter Repo-Owner in `addRepo`.

---

## Kleinere Punkte

- **`RunLog.load` hat keine Fehlerbehandlung** (`components/RunLog.tsx:32-42`): ein fehlgeschlagener Fetch lässt `loading` dauerhaft auf `true` und erzeugt eine unhandled Rejection. `Settings`, `WorkerDashboard` und `SystemMonitor` machen es alle richtig — das hier ist der einzige Ausreißer. *(offen aus dem letzten Review)*
- **`stepCounter` ist immer noch toter Zustand.** `lib/worker-loop.ts:106` schreibt ihn, niemand liest ihn; der Doc-Kommentar (`:51-57`) beschreibt eine „1-in-10-Fehlerkadenz" aus dem simulierten Loop (req-004), die es nicht mehr gibt. Ersatzlos entfernen — inklusive Parameter von `runOnce`. *(offen)*
- **`recurringPrompt` erzeugt für „Doku" weiter einen kaputten Satz** („Führe eine Doku für dieses Repo durch", `lib/claude-runner.ts:110`). Für „Ideen" ist das mit `ideaPrompt` gelöst; Doku braucht dieselbe Behandlung. Dazu kennt `TASK_SOURCES` (`lib/task-source.ts:39`) ein `security-review`, das in `DEFAULT_TASK_TYPES` (`lib/task-types.ts:48-54`) nicht existiert — obwohl die Vision es unter P3 nennt.
- **`prepareRepo` läuft vor der Leerprüfung** (`lib/execute-step.ts:124` vs. `:135-137`): Für jedes Repo × datei-getriebenen Typ wird alle 5 Minuten geklont/gefetcht und hart zurückgesetzt, auch wenn `ready/` leer ist und der Schritt sofort skippt. Bei 2 Repos sind das ~1.150 `git fetch` pro Tag gegen GitHub für nichts. Ein `git ls-tree`/Sparse-Check vorweg oder ein Fetch-Cache pro Pass würde das erledigen.
- **`/api/system-metrics` bleibt unverhältnismäßig teuer** (`lib/system-metrics-host.ts:114-132`): alle Host-PIDs, je zwei Dateilesevorgänge, sekündlich gepollt (`components/SystemMonitor.tsx:21,41`) pro offenem Tab. `sampleCache` (`:58`) ist prozessweit und mutable — parallele Requests überschreiben sich den Bezugspunkt. Ein geteiltes In-Flight-Promise pro Sekunde löst beides. *(offen aus dem letzten Review)*
- **Retention sortiert bei jedem Insert die volle Tabelle** (`lib/pg-store.ts:244-249`): `ORDER BY id DESC OFFSET 1000000` läuft pro Log-Zeile. Bei kleinem Log unauffällig, wächst aber genau dann, wenn es weh tut. Nur alle N Inserts oder per Cron aufräumen. *(offen)*
- **File-Store vergibt IDs nach `clear()` neu** (`lib/run-log-store.ts:70` beginnt wieder bei 1, der Memory-Store zählt bewusst weiter, Postgres nutzt `BIGSERIAL`). `key={e.id}` in `RunLog.tsx:86` kann dadurch beim Nachladen kollidieren. Betrifft nur den Zero-Infra-Pfad. *(offen)*
- **`next lint` ist in Next 15.5 deprecated** und `.eslintrc.json` ist die Alt-Konfiguration zu ESLint 9. Läuft heute noch, wird aber mit Next 16 brechen — `stack.md` nennt `npm run lint` als verbindlichen Befehl, das sollte nicht überraschend ausfallen. Migration auf `eslint.config.mjs` (Flat Config) einplanen.
- **Testlücken zu den Befunden oben:** Es gibt keinen Test für „Push scheitert bei erfolgreichem Schritt" (Befund 1 — der vorhandene Test schreibt das falsche Verhalten fest), keinen für „Analyse-Task committet fremde Änderungen" (Befund 3) und keinen für die Zeitzone (Befund 2). Nach der Testpolicy in `stack.md` gehört zu jedem der Fixes ein zuerst rot laufender Test.

---

## Was gut ist

Die Fixes aus dem letzten Durchgang sind nicht nur vorhanden, sie sitzen an der richtigen Stelle. `authEnv` (`lib/workspace.ts:126`) löst bug-003 über `GIT_CONFIG_*` statt über die Kommandozeile — der Token steht damit weder in `.git/config` noch in `ps`, und der Kommentar erklärt genau das. `redact` ist bewusst zweischichtig (bekannte Secrets literal, Credential-Formen per Muster) und wird an jeder Ausgangsstelle aufgerufen statt an einer zentralen, die man vergessen kann. `retryingOnce` (`lib/pg-store.ts:65`) ist die kleinstmögliche korrekte Antwort auf bug-005. `parkFailed` (`lib/execute-step.ts:264`) hat die Reihenfolge discard → move → commit genau richtig, und der Test dazu (`execute-step.test.ts:530`) prüft die Reihenfolge, nicht nur das Ergebnis — das ist der Unterschied zwischen „getestet" und „abgesichert".

`lib/appbaua-standard.ts` (req-012) ist die sauberste Datei im Repo: Quelle wird zur Laufzeit gelesen statt hartkodiert, alles wird lokal aufgebaut und in einem Commit gepusht, der Fehlerpfad verwirft, `queueAppbauaStandard` serialisiert und überlebt eine abgelehnte Promise. Auch die Store-Seam ist über alle fünf Datenbereiche konsequent durchgezogen, die Trennung reiner Logik (`scheduling`, `task-source`, `dashboard`, `system-metrics`, `review-report`) von I/O ist vollständig, und `now` wird überall injiziert. Die Kommentare erklären durchgängig das *Warum* — an mehreren Stellen war das der Grund, warum eine Absicht überhaupt prüfbar wurde, und an genau zwei Stellen (Befund 1 und 3) war der Widerspruch zwischen Kommentar und Code der Weg zum Fund.

---

**Empfehlung:** Befund 1 zuerst — er kostet im Betrieb reale Arbeit (bis zu 60 Minuten Claude-Lauf pro verlorenem Schritt), meldet dabei „Erfolg" und hält gleichzeitig die Pause aus bug-002 aus. Zusammen mit Befund 7 in einem Zug erledigen, das sind zwei Hälften desselben Problems. Befund 2 danach: er ist eine Ein-Zeilen-Änderung an `docker-compose.yml` plus `tzdata`, macht aber den Unterschied zwischen „die Zeitfenster funktionieren" und „sie funktionieren scheinbar". Befund 3 und 4 sind beide klein (ein `discardChanges`, ein `redact`) und schließen den Weg, auf dem ungeprüfte Änderungen bzw. ein Secret dauerhaft im Repo landen. Befund 8 bleibt der Gatekeeper vor Phase 2.
