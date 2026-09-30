---
type: security
repo: AppBaua
commit: 4b84e3e
date: 2026-09-30
---

# Security: AppBaua (4b84e3e)

Automatisch erstellt vom appbaua-Worker am 2026-09-30.

Prüfung abgeschlossen. Ein Hinweis vorab, der auch im Bericht steht: eine meiner Probes hat versehentlich Live-Zustand auf prod geändert (Worker-Hauptschalter aus). Ich habe ihn sofort auf den Ausgangswert `true` zurückgesetzt und das verifiziert.

---
type: security
repo: AppBaua
commit: 4b84e3e
date: 2026-09-30
---

# Security: appbaua (4b84e3e)

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen die aus `delivery/devops.md` und `CLAUDE.md` ableitbaren Vorgaben (beide Umgebungen bewusst öffentlich über Cloudflare Tunnel, Passkey-Zugangsschutz nach req-023, HTTPS als dokumentierte Origin-Form) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte Kernbefund — **ein frei erfundener Session-Cookie genügt für vollen Zugriff** — besteht **unverändert** fort, zum **achten Mal in Folge**, wieder auf `dev.appbaua.com` **und** `app.appbaua.com`. Nur **3 von 33** Route-Handlern prüfen die Session. Neu an diesem Lauf: der **schreibende** Teil ist jetzt nicht mehr nur erschlossen, sondern **live belegt** — ein unauthentifizierter `PUT /api/worker-state` hat den **Hauptschalter der Produktion tatsächlich umgelegt** (ungewollt, im Rahmen dieser Prüfung; sofort zurückgesetzt, siehe Abschnitt „Eingriff in prod"). Weder in `delivery/requirements/ready/` noch in `delivery/bugs/ready/` liegt ein Arbeitspaket, das diese Lücke adressiert — beide Ordner sind leer. Daneben unverändert: kein HTTPS-Zwang, kein HSTS, keine Backup-Strategie, `deploy/*.env` nicht ignoriert. **Eine Korrektur am Vorbericht:** dessen Empfehlung, `npm audit fix` ohne `--force` behebe zwei der vier Advisories, gilt nicht mehr — heute behebt sie **null**. Keine Secrets im Repo oder in der Git-Historie.

---

## 1. Gefälschter Session-Cookie genügt für vollen, auch schreibenden Zugriff — auf dev UND prod (hoch)

`middleware.ts:38` prüft ausschließlich, ob der Cookie `appbaua_session` überhaupt gesetzt ist (`Boolean(request.cookies.get(...)?.value)`), nicht ob der Wert einer existierenden Session entspricht. Von **33** Route-Handlern unter `app/api/` rufen weiterhin nur **drei** `currentUser()` auf (`auth/backup-codes`, `auth/invitations`, `auth/me`). Zehn weitere sind der legitim öffentliche Auth-Bereich. Die verbleibenden **20 validieren nichts**.

**Live heute verifiziert** mit `Cookie: appbaua_session=security-check-2026-09-30-never-issued-value` — einem Wert, der nie ausgestellt wurde:

```
dev  GET /api/repos           ohne=401  fake=200 {"repos":[{"id":"r17849250898901","name":"appbaua",…
dev  GET /api/github-repos    ohne=401  fake=200 [1637B] {"repos":[{"fullName":"kruianer/appbaua"},…
dev  GET /api/run-log         ohne=401  fake=200 [7755B] 50 Verlaufseinträge
dev  GET /                    ohne=307→/login  fake=200 [17.000B] gerenderte Steuerungsoberfläche
prod GET /api/repos           ohne=401  fake=200 [1204B] {"repos":[{"name":"LivingGardenTwin",…
prod GET /api/github-repos    ohne=401  fake=200 [1637B] private Repo-Liste des Betreibers
prod GET /api/health          ohne=401  fake=200 [5006B] {"apps":[{"lamp":"green","detail":"8 Container laufen",…
prod GET /api/system-metrics  ohne=401  fake=200 {"disk":{"freeBytes":231996588032,…
prod GET /api/run-log         ohne=401  fake=200 [25.848B] 50 Verlaufseinträge
prod GET /api/worker-status   ohne=401  fake=200 [5180B] {"phase":"running","currentRepo":"AppBaua",…
prod GET /                    ohne=307→/login  fake=200 [18.262B] gerenderte Steuerungsoberfläche
```

`app/page.tsx:9-20` lädt `listRepos()`, `listTaskTypes()` und `getWorkerState()` ohne jede Session-Prüfung — der Kommentar in `middleware.ts:4-12`, die echte Prüfung finde „in den API-Routen und Page-Server-Components" statt, ist für beide genannten Orte nachweislich falsch.

**Die Schreibpfade sind jetzt live belegt.** Ich habe sie mit absichtlich ungültigem Body angefragt, damit der Handler vor jeder Wirkung abbricht: kommt `400` statt `401`, ist der Handler erreicht und die Auth hat nicht gegriffen.

```
dev/prod POST /api/health/restart  ohne=401  fake=400 {"error":"repoId und container nötig."}
dev/prod POST /api/health/analyze  ohne=401  fake=400 {"error":"repoId nötig."}
dev/prod PUT  /api/worker-state    ohne=401  fake=200 {"state":{"enabled":false}}  ← hat GESCHRIEBEN
```

Der letzte Fall war nicht als Schreibvorgang geplant: `app/api/worker-state/route.ts:11` wertet `!!body.enabled` aus, ein fehlendes Feld ist also `false` und wird geschrieben — es gibt keine Validierung, die vorher abbricht. prod stand vor dem Aufruf auf `enabled: true` und danach auf `false`; `worker-status` wechselte im selben Moment von `phase: "running"` auf `"stopped"`. **Damit ist belegt, dass ein Fremder mit einem erfundenen Cookie die Produktion anhalten kann** — kein erschlossenes Risiko mehr, sondern ein eingetretener Vorgang.

**Weitere schreibende Reichweite** (aus dem Code erschlossen, bewusst nicht ausgeführt):

| Route | Wirkung |
|---|---|
| `POST /api/repos/[id]/appbaua` | klont ein fremdes Repo und pusht auf dessen `dev`-Branch (req-012, Token mit Schreibrecht) |
| `POST /api/health/restart` | startet einen Container einer überwachten App neu — **begrenzt**: `lib/health-service.ts:181-186` lässt nur Container zu, die zu einem `monitored` Repo passen, nicht beliebige Container des Hosts |
| `POST /api/health/analyze` | lässt appbaua den **KI-Schlüssel einer anderen App aus deren Container lesen** (`lib/log-analysis-service.ts:110-169`, via health-agent) und verbraucht damit fremdes Kontingent |
| `DELETE /api/repos/[id]`, `DELETE /api/run-log` | löscht Repos bzw. den gesamten Verlauf |
| `PATCH/PUT /api/task-types/*`, `PUT /api/health/settings` | Zeitpläne und Überwachungseinstellungen |

**Empfehlung:** Ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender **oder ungültiger** Session 401 liefert, angewandt auf **jeden** nicht-öffentlichen Route-Handler; für die Seiten zusätzlich eine `currentUser()`-Prüfung mit Redirect in `app/page.tsx` bzw. im Layout. Der irreführende Kommentar in `middleware.ts:4-12` ist mitzukorrigieren. Zweitens: `PUT /api/worker-state` sollte einen fehlenden `enabled`-Wert mit `400` abweisen statt ihn als `false` zu schreiben. Das ist mit deutlichem Abstand der wichtigste offene Punkt des Repos — er liegt seit acht Wochen offen, betrifft die Produktion, und es existiert **kein Arbeitspaket dafür**: `delivery/requirements/ready/` und `delivery/bugs/ready/` sind leer. Solange das so bleibt, wird dieser Bericht den Punkt nur weiter wiederholen.

**Verifikation:** live gegen `dev.appbaua.com` und `app.appbaua.com` (Lesepfade nur GET; Schreibpfade mit ungültigem Body, außer dem dokumentierten `worker-state`-Vorgang) + Codeabgleich.

## 2. HTTPS wird auf keiner der beiden Zonen erzwungen, keine Security-Header (mittel)

```
http://dev.appbaua.com/login  → 200, kein Redirect
http://app.appbaua.com/login  → 200, kein Redirect
https://dev.appbaua.com/login → 200, HSTS/CSP/X-Frame-Options: NICHT GESETZT
https://app.appbaua.com/login → 200, HSTS/CSP/X-Frame-Options: NICHT GESETZT
```

Unverändert gegenüber acht Vorberichten. Das Session-Cookie ist `Secure` und WebAuthn verlangt ohnehin einen Secure Context — aber jede Anfrage, bei der nicht ausdrücklich `https://` eingegeben wird, geht zunächst im Klartext hinaus, und es folgt kein Upgrade. `next.config.ts` enthält keinen `headers()`-Block, der Schutz hinge also selbst nach einer Dashboard-Umstellung allein an Cloudflare.

**Empfehlung:** „Always Use HTTPS" im Cloudflare-Dashboard für beide Zonen aktivieren **und** `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht an einer einzelnen Dashboard-Einstellung hängt. `X-Frame-Options: DENY` (oder `frame-ancestors 'none'`) im selben Zug — die Steuerungsoberfläche gehört in keinen fremden Frame.

**Verifikation:** live (HTTP- und HTTPS-Abruf heute gegen beide Umgebungen) + Code (`next.config.ts`).

## 3. Dokumentierter Pfad für die env-Dateien ist nicht ignoriert — der Worker committet mit `git add -A` (niedrig)

`docker-compose.yml:4-7` und `delivery/devops.md:24` nennen `deploy/dev.env` / `deploy/prod.env` als Ort der Geheimnisse (GITHUB_TOKEN, DB-Passwort, `CLOUDFLARE_TUNNEL_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WATCHDOG_TOKEN`) und versichern jeweils, diese Dateien seien „bewusst nicht versioniert". Das trifft nicht zu:

```
git check-ignore -v deploy/dev.env   → NOT IGNORED
git check-ignore -v deploy/prod.env  → NOT IGNORED
git check-ignore -v .env             → .gitignore:23
```

`.gitignore:23` enthält nur `.env` (trifft ausschließlich den Basename) und `.env*.local`. Ein Verzeichnis `deploy/` mit `*.env` ist von keinem Muster erfasst. Verschärfend: `lib/workspace.ts` committet mit `git add -A` — wer der Dokumentation folgt und die Datei am genannten Ort anlegt, hat sie beim nächsten Worker-Lauf im Repo. (`.dockerignore` deckt `.env`/`.env.*` ab, `deploy/` ebenfalls nicht.)

**Warum trotzdem nur „niedrig":** Die reale Installation weicht von der Doku ab. `.github/workflows/deploy.yml:50-53` legt die Dateien unter `~/appbaua-env/*.env` ab, also außerhalb jeder Arbeitskopie. Es liegt heute nichts offen — die Lücke ist eine Falle, keine aktive Preisgabe. Die Historienprüfung bestätigt das: `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei **nur** `.env.example` (Template, alle Werte leer).

**Empfehlung:** Zwei Zeilen, die die Falle schließen: `deploy/` und `*.env` (mit `!.env.example`) in `.gitignore`. Parallel den Pfad in `docker-compose.yml` und `delivery/devops.md` auf den tatsächlich verwendeten `~/appbaua-env/` korrigieren, damit Doku und Installation dasselbe sagen.

**Verifikation:** aus Code/Config erschlossen (`git check-ignore` gegen die reale `.gitignore` ausgeführt, keine Dateien angelegt oder verändert).

## 4. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` existiert keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo gibt es weiterhin keinen Dump-/Snapshot-/Restore-Mechanismus: die Suche nach `pg_dump|pg_restore|barman|wal-g|restic|borgbackup|pgbackrest` über den gesamten Tracked-Bestand liefert nur Treffer in `delivery/idea/backup-mit-restore-drill-nachweis.md` — also einen **Vorschlag**, keine Umsetzung — und in früheren Sicherheitsberichten. Das `db-data`-Volume ist ungesichert, `.github/workflows/deploy.yml` enthält keinen Backup-Schritt. (Abzugrenzen von req-031 — Backup-Codes sind Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; die bereits vorliegende Idee `backup-mit-restore-drill-nachweis.md` ist der passende Umsetzungsweg. Ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen — er steht jetzt im sechsten Bericht.

**Verifikation:** aus Code/Config erschlossen.

## 5. `npm audit`: 1 kritische, 3 hohe transitive Advisories — `npm audit fix` behebt davon jetzt keine (niedrig)

`npm audit --omit=dev`: 1 kritisch, 3 hoch. Alle vier hängen an `next` (`npm ls`: `next@15.5.21 → postcss@8.4.31 → nanoid@3.3.16`; `sharp` als optionale Abhängigkeit von `next`).

| Paket | Installiert | Verwundbarer Bereich | Bewertung hier |
|---|---|---|---|
| `next` | 15.5.21 | `9.3.4-canary.0 – 16.3.0-preview.10` | **GHSA-p293-qw3h-jr36** (unauth. RCE) betrifft ausdrücklich nur **Windows-gehostete** Server — dieses Repo läuft auf einem Ubuntu-Beelink. **GHSA-2xp9-vwfh-vxw4** (RCE über die Image-Optimization-API bei AVIF) setzt `next/image` voraus — kein Treffer in `app/`, `components/`, `lib/`, und `next.config.ts` hat keinen `images`-Block. |
| `postcss` | 8.4.31 | `<=8.5.22` | vier `sourceMappingURL`-Advisories plus neu **GHSA-qx2v-qp2m-jg93** (XSS über unescaptes `</style>`), nur über Build-Zeit-CSS erreichbar. |
| `sharp` | 0.34.5 | `<=0.35.4-rc.0` | geerbte libvips-/libheif-CVEs; nur über den ungenutzten `next/image`-Pfad erreichbar. |
| `nanoid` | 3.3.16 | `<3.3.18` | Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen. |

**Korrektur am Vorbericht.** Der Bericht vom 2026-09-23 empfahl, `npm audit fix` ohne `--force` auszuführen — zwei der vier Advisories (`sharp`, `nanoid`) würden damit risikoarm verschwinden. Das gilt nicht mehr: In einer Kopie von `package.json`/`package-lock.json` geprüft (`npm audit fix --dry-run --package-lock-only`, nichts installiert oder geschrieben) bleiben **alle vier Versionen unverändert** — `next 15.5.21`, `postcss 8.4.31`, `sharp 0.34.5`, `nanoid 3.3.16` — und die Bilanz steht danach weiter bei 4 Advisories. Auch **mit** `--force` ändert sich nichts. Ursache: `next` 15 pinnt `postcss` hart auf `8.4.31` (`next/package.json`) und begrenzt `sharp` auf `^0.34.3`; der `sharp`-Advisory-Bereich ist seit dem Vorbericht zudem von `<=0.34.x` auf `<=0.35.4-rc.0` gewachsen.

**Der Weg, der alle vier löst, ist genau einer:** `next` auf die 16er-Linie (aktuell `16.3.7`). Sie liegt oberhalb des `next`-Bereichs und bringt `postcss 8.5.23` (> `8.5.22`, behoben) sowie `sharp ^0.35.4` (> `0.35.4-rc.0`, behoben) mit; `nanoid` folgt über `postcss`.

**Empfehlung:** Den Upgrade auf `next` 16 als eigenes Arbeitspaket einplanen — er ist inzwischen der einzige Hebel, und die Test-Suite (`npm test`, `lint`, `typecheck` im Deploy-Workflow) deckt die Regression ab. Die praktische Angriffsvoraussetzung fehlt heute weiterhin (Linux-Host, kein `next/image`), das rechtfertigt „niedrig" trotz „kritisch" im Advisory. Sollte `next/image` künftig eingeführt werden, wird GHSA-2xp9-vwfh-vxw4 sofort relevant — dann muss das Upgrade vorgezogen werden. `npm audit fix` sollte **nicht** mehr als Maßnahme geführt werden; es ist wirkungslos.

**Verifikation:** live (`npm audit`, `npm audit fix --dry-run` mit und ohne `--force` in `/tmp` gegen Kopien der Manifeste; `npm view` für die veröffentlichten Versionen und die Abhängigkeiten von `next@16.3.7`) + Code-Grep (kein `next/image`) + Host-OS aus `devops.md`.

---

**Geprüft und unauffällig:**

- **Code-Delta seit `a152978`** — `lib/workspace.ts` + `worker/index.ts` (bug-023: ein Lauf nimmt seinen Prozessbaum mit) und die neue `lib/workspace-process-tree.test.ts`. Die neuen `process.kill(-pid, …)`-Aufrufe treffen nur Gruppen, deren PID der Prozess selbst in `liveGroups` eingetragen hat, und werden nach dem Abräumen wieder ausgetragen — keine Eskalation, kein `sudo`, keine Shell, kein Secret- oder Netzwerkbezug. Das ist eine Ressourcen-Korrektur, kein Sicherheitsthema. Kein Fund.
- **Secrets im Repo und in der gesamten Git-Historie** — `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei nur `.env.example` (alle Werte leer). Treffer auf `ghp_`/`github_pat_`/`sk-ant-` liegen ausschließlich in `lib/redact.ts` (Erkennungsmuster), in `*.test.ts` (synthetische Fixtures) und in den Sicherheitsberichten selbst. Vgl. aber Finding 3 zur `.gitignore`-Lücke.
- **Wirksamkeit der Redaction** — der unauthentifiziert abrufbare `/api/run-log` auf prod (50 Einträge, 25 KB) und `/api/worker-status` (Live-Ausgabe von Claude Code) enthalten **keine** Klartext-Secrets; die Suche nach `ghp_`/`github_pat_`/`sk-ant-` in der Antwort bleibt leer. `lib/worker-status.ts:175` und `lib/worker-loop.ts:226,247` filtern vor dem Schreiben. Die Disclosure aus Finding 1 bleibt, aber sie umfasst keine Zugangsdaten.
- **Datenmodell / personenbezogene Daten** — `lib/schema.sql:154-215` speichert zu Personen nur opake IDs: kein Name, keine E-Mail, keine IP. Passkeys liegen als öffentlicher Schlüssel (das ist ihr Zweck), Backup-Codes nur als Hash (`code_hash`, beim Verbrauch auf `NULL`), Sessions als opake ID mit `expires_at`. Sauber; datenschutzrechtlich ist hier fast keine Angriffsfläche.
- **Die drei Routen, die prüfen, prüfen richtig** — mit dem Fake-Cookie: `/api/auth/backup-codes` → `401 {"error":"unauthorized"}`, `/api/auth/me` → `200 {"user":null}`. Der Mechanismus funktioniert; er ist nur fast nirgends angewandt.
- **Ausfallwächter beim Webhoster** (`watchdog/`) — unverändert seit dem Vorbericht: beide öffentlichen Endpunkte verlangen die Kennung, der Vergleich läuft timing-safe über `hash_equals`, das Geheime liegt außerhalb des Web-Verzeichnisses und ist korrekt in `.gitignore:39`.
- **Docker-/Compose-Hygiene** — Docker-Socket weiterhin nur im `health-agent`, der keinen Port veröffentlicht und laut `agent/routes.ts` genau **fünf** Operationen annimmt (auflisten, eine env-Variable, exec, logs, restart — `logs` kam mit req-035 hinzu; der Vorbericht nannte noch vier). Kein Host-Root-Mount (nur `/proc:ro`, mit Begründung aus bug-005); der `db`-Dienst veröffentlicht keinen Port.
- **Deploy-Workflow** — läuft nur auf `push` für `[dev, main]`, nicht auf `pull_request`; kein Fork-Zugriff auf den self-hosted Runner. Die env-Datei wird vom Host (`$HOME/appbaua-env/`) gelesen, nicht aus dem Checkout. Test-Gate (`lint`, `typecheck`, `test`) läuft vor dem Deploy.
- **Rate-Limit auf `/recovery`** — erneut bewertet und verworfen. `lib/rate-limit.ts` ist trotz des Namens die Behandlung von Claude-API-Limits, kein Login-Schutz; es gibt also keinen. Backup-Codes haben aber 80 Bit Entropie (`randomBytes(10)`), Brute-Force ist auch ungebremst nicht praktikabel.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), Cronjob-Einrichtung des Wächters beim Hoster, Dateirechte der tatsächlichen `~/appbaua-env/*.env`.

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer genau darf zugreifen" und „welche Backup-Erwartung gilt" sind nirgends festgeschrieben — Finding 4 lässt sich ohne dieses SOLL nicht abschließen. Der Skill `setup-security` legt die Datei an.

---

## Eingriff in prod während dieser Prüfung

Zur Transparenz, weil es über eine reine Prüfung hinausging: Der Beleg der Schreibpfade in Finding 1 war so angelegt, dass ein ungültiger Body den Handler vor jeder Wirkung abbricht. Bei `PUT /api/worker-state` trifft diese Annahme nicht zu — der Handler wertet `!!body.enabled` aus, und ein leerer Body `{}` bedeutet dort `enabled: false`, was sofort geschrieben wird. Folge:

- prod stand vor dem Aufruf auf `enabled: true`, danach auf `enabled: false`; `worker-status` wechselte von `phase: "running"` auf `"stopped"`.
- Ich habe prod unmittelbar danach mit `PUT {"enabled":true}` auf den Ausgangswert zurückgesetzt und per `GET` verifiziert: `{"state":{"enabled":true}}`.
- dev stand vor **und** nach dem Aufruf auf `enabled: false` — dort hat sich nichts geändert.

Beide Umgebungen sind damit im Zustand von vor der Prüfung. Am Repo wurde nichts geändert; alle übrigen Live-Abrufe waren GET oder wurden mit `400` vor jeder Wirkung abgewiesen. Der Vorgang ist unbeabsichtigt, aber er ist der bislang deutlichste Beleg für Finding 1: was mir hier versehentlich gelang, gelingt jedem, der die URL kennt.
