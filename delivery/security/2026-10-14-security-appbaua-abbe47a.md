---
type: security
repo: AppBaua
commit: abbe47a
date: 2026-10-14
---

# Security: AppBaua (abbe47a)

Automatisch erstellt vom appbaua-Worker am 2026-10-14.

---
type: security
repo: appbaua
commit: abbe47a
date: 2026-10-14
---

# Security: appbaua (abbe47a)

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen das aus `delivery/devops.md` und `CLAUDE.md` ableitbare SOLL (beide Umgebungen bewusst öffentlich über Cloudflare Tunnel, Passkey-Zugangsschutz nach req-023, HTTPS als dokumentierte Origin-Form, zusätzlich WLAN-Zugang über `APP_PORT`) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte Kernbefund — **ein frei erfundener Session-Cookie genügt für vollen Zugriff** — besteht **unverändert** fort, zum **zehnten Mal in Folge**, heute erneut live belegt auf `dev.appbaua.com` **und** `app.appbaua.com`. Nach wie vor prüfen nur **3 von 33** Route-Handlern die Session; die 20 nicht-öffentlichen prüfen **nichts**. Am relevanten Code hat sich seit dem Vorbericht **nichts** geändert: die fünf Commits seit `6fe0139` berühren außerhalb von `delivery/` ausschließlich `Dockerfile.worker` und dessen Test (bug-024, Systemwerkzeuge im Worker-Image). `delivery/requirements/ready/` und `delivery/bugs/ready/` sind weiterhin **leer** — es existiert kein Arbeitspaket für die Lücke. Daneben unverändert: kein HTTPS-Zwang, keine Security-Header, keine Backup-Strategie, `deploy/*.env` nicht ignoriert. Bei den Abhängigkeiten stehen weiterhin **5 Advisories** (1 kritisch, 4 hoch); `npm audit fix` ist erneut als wirkungslos belegt, der wirksame Weg (`next@16.4.0` + `npm update nanoid source-map-js` → **0 Advisories**) erneut verifiziert. Keine Secrets im Repo oder in der Git-Historie; die Redaction wirkt. **Neu und unauffällig:** dieser Lauf konnte erstmals aus dem Worker-Container selbst prüfen und hat die Secret-Hygiene **aller acht betreuten Repos** gegen das `git add -A` des Workers abgeglichen — kein einziges Repo hat eine ungeschützte Secret-Datei, die ein Worker-Commit erfassen würde.

Gegen die Live-Umgebungen liefen **ausschließlich `GET`**-Anfragen. Kein Schreibpfad wurde angefragt, auch nicht mit ungültigem Body.

---

## 1. Gefälschter Session-Cookie genügt für vollen Zugriff — auf dev UND prod (hoch)

`middleware.ts:38` prüft ausschließlich, ob der Cookie `appbaua_session` überhaupt einen Wert hat (`Boolean(request.cookies.get(SESSION_COOKIE)?.value)`), nicht ob dieser Wert einer existierenden Session entspricht. Von **33** Route-Handlern unter `app/api/` rufen weiterhin nur **drei** `currentUser()` auf (`auth/backup-codes`, `auth/invitations`, `auth/me`); 13 liegen im legitim öffentlichen Auth-Bereich, die verbleibenden **20 validieren nichts**.

**Heute live verifiziert** mit `Cookie: appbaua_session=security-check-2026-10-14-never-issued` — einem Wert, der nie ausgestellt wurde:

```
dev  GET /api/repos          ohne=401        fake=200 [139B]    {"repos":[{"id":"r17849250898901","name":"appbaua",…
dev  GET /api/github-repos   ohne=401        fake=200 [1783B]   private Repo-Liste des Betreibers
dev  GET /api/run-log        ohne=401        fake=200 [7755B]   Verlaufseinträge
dev  GET /api/task-types     ohne=401        fake=200 [2488B]   komplette Zeitplanung
dev  GET /api/system-metrics ohne=401        fake=200 [189B]    {"disk":{"freeBytes":175202680832,…
dev  GET /                   ohne=307→/login fake=200 [16.980B] gerenderte Steuerungsoberfläche
prod GET /api/repos          ohne=401        fake=200 [1323B]   {"repos":[{"name":"LivingGardenTwin",…
prod GET /api/github-repos   ohne=401        fake=200 [1783B]   private Repo-Liste des Betreibers
prod GET /api/run-log        ohne=401        fake=200 [29.503B] Verlaufseinträge
prod GET /api/worker-status  ohne=401        fake=200 [6489B]   {"phase":"running","currentRepo":"AppBaua",…
prod GET /api/health         ohne=401        fake=200 [5056B]   {"apps":[{"lamp":"green","detail":"8 Container laufen",…
prod GET /api/system-metrics ohne=401        fake=200 [189B]    {"disk":{"freeBytes":175202672640,…
prod GET /                   ohne=307→/login fake=200 [18.381B] gerenderte Steuerungsoberfläche
```

`app/page.tsx` enthält **keinen einzigen** Treffer auf `currentUser` oder `redirect` — die Seite lädt `listRepos()`, `listTaskTypes()` und `getWorkerState()` ohne jede Session-Prüfung. Der Kommentar in `middleware.ts:4-12`, die echte Prüfung finde „in den auth API routes and page server components" statt, ist für beide genannten Orte nachweislich falsch — unverändert seit zehn Wochen.

**Schreibende Reichweite** (aus dem Code erschlossen; `PUT /api/worker-state` wurde am 2026-09-30 versehentlich live belegt und hat damals den prod-Hauptschalter umgelegt):

| Route | Wirkung |
|---|---|
| `PUT /api/worker-state` | hält den Worker der Produktion an. `app/api/worker-state/route.ts:11` wertet `!!body.enabled` aus — ein leerer Body `{}` bedeutet `false` und wird ohne Validierung geschrieben |
| `POST /api/repos/[id]/appbaua` | klont ein fremdes Repo und pusht auf dessen `dev`-Branch (req-012, Token mit Schreibrecht) |
| `POST /api/health/restart` | startet einen Container einer überwachten App neu — **begrenzt**: `lib/health-service.ts:181-186` lässt nur Container zu, die zu einem `monitored` Repo passen |
| `POST /api/health/analyze` | lässt appbaua den KI-Schlüssel einer anderen App aus deren Container lesen (`lib/log-analysis-service.ts:110-169`) und verbraucht fremdes Kontingent |
| `DELETE /api/repos/[id]`, `DELETE /api/run-log` | löscht Repos bzw. den gesamten Verlauf |
| `PATCH/PUT /api/task-types/*`, `PUT /api/health/settings` | Zeitpläne und Überwachungseinstellungen |

Hinzu kommt: der App-Container veröffentlicht laut `docker-compose.yml:108-109` zusätzlich `${APP_PORT}:3000` ohne TLS. Auf diesem Weg ist dieselbe Lücke im WLAN auch im Klartext erreichbar — das Cookie ist zwar `Secure` und würde vom Browser dort nicht gesendet, ein manuell gesetzter Header unterliegt dieser Einschränkung aber nicht.

**Empfehlung:** Ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender **oder ungültiger** Session 401 liefert, angewandt auf **jeden** nicht-öffentlichen Route-Handler; für die Seiten zusätzlich eine `currentUser()`-Prüfung mit Redirect in `app/page.tsx` bzw. im Layout. Der irreführende Kommentar in `middleware.ts:4-12` ist mitzukorrigieren. Zweitens: `PUT /api/worker-state` sollte einen fehlenden `enabled`-Wert mit `400` abweisen statt ihn als `false` zu schreiben. Das ist mit deutlichem Abstand der wichtigste offene Punkt des Repos. Entscheidend ist dabei weniger die technische Lösung — die ist seit zehn Berichten dieselbe und unstrittig — als dass daraus ein **Arbeitspaket** wird: `delivery/bugs/ready/` und `delivery/requirements/ready/` sind beide leer, und ohne eine Datei darin greift der Worker den Punkt nie auf. In Woche elf steht hier sonst derselbe Text.

**Verifikation:** Lesepfade **live** gegen `dev.appbaua.com` und `app.appbaua.com` (ausschließlich `GET`); Schreibpfade **aus Code erschlossen** + Live-Beleg des Berichts vom 2026-09-30; Codeabgleich `git diff 6fe0139..HEAD` (berührt außerhalb `delivery/` nur `Dockerfile.worker`).

## 2. HTTPS wird auf keiner der beiden Zonen erzwungen, keine Security-Header (mittel)

```
http://dev.appbaua.com/login  → 200, kein Redirect
http://app.appbaua.com/login  → 200, kein Redirect
https://dev.appbaua.com/login → 200   (server: cloudflare)
https://app.appbaua.com/login → 200   (server: cloudflare)
HSTS / CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy /
Permissions-Policy: auf allen vier NICHT GESETZT
```

Unverändert gegenüber zehn Vorberichten. Das Session-Cookie ist `Secure` und WebAuthn verlangt ohnehin einen Secure Context — aber jede Anfrage, bei der nicht ausdrücklich `https://` eingegeben wird, geht zunächst im Klartext hinaus, und es folgt kein Upgrade. `next.config.ts` enthält keinen `headers()`-Block; der Schutz hinge also selbst nach einer Dashboard-Umstellung allein an Cloudflare.

**Empfehlung:** „Always Use HTTPS" im Cloudflare-Dashboard für beide Zonen aktivieren **und** `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht an einer einzelnen Dashboard-Einstellung hängt. `X-Frame-Options: DENY` (oder `frame-ancestors 'none'`) und `X-Content-Type-Options: nosniff` im selben Zug — die Steuerungsoberfläche gehört in keinen fremden Frame.

**Verifikation:** **live** (HTTP- und HTTPS-Abruf heute gegen beide Umgebungen, Header ausgelesen) + Code (`next.config.ts`).

## 3. Dokumentierter Pfad für die env-Dateien ist nicht ignoriert — der Worker committet mit `git add -A` (niedrig)

`docker-compose.yml:4-7` und `delivery/devops.md:24,53-56,79-81,117-118` nennen `deploy/dev.env` / `deploy/prod.env` als Ort der Geheimnisse (`GITHUB_TOKEN`, DB-Passwort, `CLOUDFLARE_TUNNEL_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WATCHDOG_TOKEN`) und versichern mehrfach, diese Dateien seien „bewusst nicht versioniert". Das trifft nicht zu:

```
git check-ignore -v deploy/dev.env              → NOT IGNORED
git check-ignore -v deploy/prod.env             → NOT IGNORED
git check-ignore -v .env                        → .gitignore:23
git check-ignore -v watchdog/private/config.php → .gitignore:39
```

`.gitignore:23` enthält nur `.env` (trifft ausschließlich den Basename) und `.env*.local`; ein Verzeichnis `deploy/` mit `*.env` ist von keinem Muster erfasst. Verschärfend: `lib/workspace.ts:887` committet mit `git add -A` — wer der Dokumentation folgt und die Datei am genannten Ort anlegt, hat sie beim nächsten Worker-Lauf im Repo. `.dockerignore` deckt `.env`/`.env.*` ab, `deploy/` ebenfalls nicht.

**Warum trotzdem nur „niedrig":** Die reale Installation weicht von der Doku ab — `.github/workflows/deploy.yml:50,53` legt die Dateien unter `$HOME/appbaua-env/{dev,prod}.env` ab, also außerhalb jeder Arbeitskopie. Ein `deploy/`-Verzeichnis existiert in der Arbeitskopie nicht. Es liegt heute nichts offen; die Lücke ist eine Falle, keine aktive Preisgabe. Die Historienprüfung bestätigt das: `git log --all --diff-filter=A` findet als je hinzugefügte env-/Key-/Config-Datei **nur** `.env.example`, und dort hat kein einzelner Schlüssel einen Wert (`grep -cE '^[A-Z_]+=.+'` → `0`).

**Empfehlung:** Zwei Zeilen, die die Falle schließen: `deploy/` und `*.env` (mit `!.env.example`) in `.gitignore`. Parallel den Pfad in `docker-compose.yml` und `delivery/devops.md` auf den tatsächlich verwendeten `~/appbaua-env/` korrigieren, damit Doku und Installation dasselbe sagen.

**Verifikation:** **aus Code/Config erschlossen** (`git check-ignore` und `git log` gegen den realen Stand ausgeführt, keine Dateien angelegt oder verändert).

## 4. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` existiert keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo gibt es weiterhin keinen Dump-/Snapshot-/Restore-Mechanismus: die Suche nach `pg_dump|pg_restore|wal-g|pgbackrest|restic|borgbackup|barman` über den gesamten getrackten Bestand liefert Treffer **nur** in `delivery/idea/backup-mit-restore-drill-nachweis.md` — also einem Vorschlag, keiner Umsetzung — und in früheren Sicherheitsberichten. Das `db-data`-Volume ist ungesichert; `.github/workflows/deploy.yml` enthält keinen Schritt mit `backup`, `dump` oder `snapshot`. (Abzugrenzen von req-031 — Backup-Codes sind Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; die vorliegende Idee `backup-mit-restore-drill-nachweis.md` ist der passende Umsetzungsweg. Ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen — er steht jetzt im achten Bericht.

**Verifikation:** **aus Code/Config erschlossen.**

## 5. `npm audit`: 5 Advisories (1 kritisch, 4 hoch) — `npm audit fix` behebt null, der wirksame Weg ist erneut verifiziert (niedrig)

`npm audit --omit=dev`: **5** Advisories, unverändert zum Vorbericht. Installierte Versionen heute: `next` 15.5.21, `postcss` 8.4.31, `sharp` 0.34.5, `nanoid` 3.3.16, `source-map-js` 1.2.1.

| Paket | Installiert | Verwundbarer Bereich | Bewertung hier |
|---|---|---|---|
| `next` | 15.5.21 | `9.3.4-canary.0 – 16.3.0-preview.10` | **GHSA-p293-qw3h-jr36** (unauth. RCE) betrifft ausdrücklich nur **Windows-gehostete** Server — dieses Repo läuft auf einem Ubuntu-Beelink. **GHSA-2xp9-vwfh-vxw4** (RCE über die Image-Optimization-API bei AVIF) setzt `next/image` voraus — heute erneut geprüft: kein Treffer in `app/`, `components/`, `lib/`, und `next.config.ts` hat keinen `images`-Block. |
| `postcss` | 8.4.31 | `<=8.5.22` | vier `sourceMappingURL`-Advisories plus GHSA-qx2v-qp2m-jg93 (XSS über unescaptes `</style>`), nur über Build-Zeit-CSS erreichbar. |
| `sharp` | 0.34.5 | `<=0.35.5-rc.1` | geerbte libvips-/libheif-/librsvg-CVEs; nur über den ungenutzten `next/image`-Pfad erreichbar. |
| `nanoid` | 3.3.16 | `<3.3.18` | Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen. |
| `source-map-js` | 1.2.1 | `1.0.0 – 1.2.1` | DoS nur beim Parsen einer Source Map, also zur Build-Zeit. |

**`npm audit fix` ist unverändert wirkungslos** — und zwar, obwohl die Ausgabe bei allen fünf Einträgen „fix available via `npm audit fix`" behauptet und mit „To address all issues, run: `npm audit fix`" schließt. In einer Kopie von `package.json`/`package-lock.json` unter `/tmp` geprüft (`npm audit fix --dry-run --package-lock-only`, nichts installiert oder im Repo geschrieben): die Bilanz danach bleibt bei **5 vulnerabilities (4 high, 1 critical)**. Ursache: `next` 15 pinnt `postcss` hart auf `8.4.31` und begrenzt `sharp` auf `^0.34.3`.

**Der wirksame Weg ist erneut vollständig verifiziert**, in einer zweiten `/tmp`-Kopie mit `next: "^16.4.0"` und `eslint-config-next: "^16.4.0"`, aufgelöst per `npm install --package-lock-only` (`npm view next version` → `16.4.0`, also weiterhin die aktuelle Hauptversion):

```
Schritt 1  next 16.4.0  postcss 8.5.23  sharp 0.35.5  nanoid 3.3.16  source-map-js 1.2.1  → 2 high
Schritt 2  npm update nanoid source-map-js
           next 16.4.0  postcss 8.5.23  sharp 0.35.5  nanoid 3.3.20  source-map-js 1.2.2  → found 0 vulnerabilities
```

`next` 16.4.0 löst drei der fünf. `nanoid` und `source-map-js` bleiben zunächst stehen, weil die alten Einträge die neuen Ranges (`^3.3.16`, `^1.2.1`) formal noch erfüllen — das Lockfile behält sie; erst das nachgeschobene `npm update` hebt sie an.

**Empfehlung:** Den Upgrade auf `next` 16 als eigenes Arbeitspaket einplanen, **mit dem `npm update nanoid source-map-js` als zweitem Schritt** — ohne ihn bleiben zwei Advisories stehen, und das ist der Punkt, an dem ein Upgrade-Versuch sonst als „hat nichts gebracht" abgebrochen würde. Die Test-Suite (`lint`, `typecheck`, `test` im Deploy-Workflow) deckt die Regression ab; `eslint-config-next` muss mitwandern. Die praktische Angriffsvoraussetzung fehlt heute weiterhin (Linux-Host, kein `next/image`) — das rechtfertigt „niedrig" trotz „kritisch" im Advisory. Sollte `next/image` künftig eingeführt werden, wird GHSA-2xp9-vwfh-vxw4 sofort relevant, dann ist das Upgrade vorzuziehen. `npm audit fix` sollte **nicht** als Maßnahme geführt werden; seine eigene Erfolgsmeldung ist hier irreführend.

**Verifikation:** **live** (`npm audit` gegen den Repo-Stand; `npm audit fix --dry-run` sowie die vollständige `next`-16-Auflösung inkl. `npm update` auf Manifest-Kopien in `/tmp`, mit Versionsvergleich vor/nach; `npm view next version`) + Code-Grep (kein `next/image`) + Host-OS aus `devops.md`.

---

**Geprüft und unauffällig:**

- **Secret-Hygiene aller acht betreuten Repos gegen `git add -A`** — *neu in diesem Lauf.* Der Worker committet mit `git add -A` (`lib/workspace.ts:887`) in **fremden** Repos; was dort hineingerät, hängt allein an der `.gitignore` des jeweiligen Repos. Für alle acht Arbeitskopien unter `/work/` geprüft (untracked **und** nicht ignoriert, Muster `.env`, `*secret*`, `*credential*`, `config.php`, `*.pem`, `*.key`, `id_rsa*`): **kein einziger Treffer**. Auch keine bereits getrackte Secret-Datei. Konkret entschärft: `/work/github-com-kruianer-livinggardentwin/.env` existiert und enthält 33 gesetzte Werte, darunter `POSTGRES_PASSWORD`, `OPENAI_API_KEY`, `PLANTNET_API_KEY`, `TELEGRAM_BOT_TOKEN` und `CLOUDFLARED_DEV_TUNNEL_TOKEN` — sie ist dort aber korrekt über `.gitignore:9` erfasst und `git status --porcelain` ist leer. Werte wurden nicht gelesen, nur Variablennamen.
- **Code-Delta seit `6fe0139`** — fünf Commits (`88afdbe`, `fccc092`, `1b54c81`, `37f9fe7`, `abbe47a`). Außerhalb von `delivery/` berühren sie ausschließlich `Dockerfile.worker` (+21 Zeilen) und `dockerfile-worker.test.ts` (+97). Kein Anwendungscode, keine Config, keine Abhängigkeit. Folge: Findings 1–5 sind sinngemäß und weitgehend Zeile für Zeile identisch zum Vorbericht.
- **`Dockerfile.worker` (bug-024)** — die Änderung ergänzt `perl exiftool python3 py3-pip make gcc g++ musl-dev python3-dev`, also auch eine Compiler-Kette, in dem Container, der den `GITHUB_TOKEN` mit Schreibrecht und die Claude-Code-Anmeldung hält. **Kein Finding:** dieser Container führt bereits per Konstruktion beliebigen, KI-erzeugten Code aus und ruft `npm ci`/`npm install` in Fremd-Repos auf (beliebige `postinstall`-Skripte) — ein Compiler erweitert die Rechte nicht, er erspart nur das Nachbauen unter `/tmp`. Der Container läuft als `USER worker` (uid 1001), nicht als root, und `Dockerfile.worker:40-43` begrenzt die Liste ausdrücklich auf das Gemessene. *Hinweis ohne Befundcharakter:* `apk add --no-cache` und `npm install -g @anthropic-ai/claude-code` sind beide unversioniert — jeder Rebuild zieht den jeweils aktuellen Stand. Für die Claude-CLI ist das gewollt; für die apk-Pakete wäre ein Pinning die reproduzierbarere Variante.
- **Laufzeit-Umgebung des Workers** — erstmals von innen geprüft: `/claude-home/.claude/.credentials.json` hat `-rw-------` (0600, Eigentümer `worker`). In der Prozess-Umgebung liegen nur `GITHUB_TOKEN` (93 Zeichen, Fine-grained-PAT-Format) und `PGPASSWORD` (32 Zeichen) — beide betriebsnotwendig, keine weiteren Secrets. Werte wurden nicht ausgegeben, nur Längen.
- **Secrets im Repo und in der gesamten Git-Historie** — `git log --all --diff-filter=A` findet als je hinzugefügte env-/Key-/Config-Datei nur `.env.example`, dort ohne einen einzigen gesetzten Wert. Treffer auf `ghp_`/`github_pat_`/`sk-ant-` liegen ausschließlich in `lib/redact.test.ts`, `lib/workspace.test.ts`, `lib/worker-loop.test.ts` und `lib/appbaua-standard.test.ts` — synthetische Fixtures, erkennbar an `A1b2C3d4E5f6…`. Keine privaten Schlüssel, keine AWS-IDs. Vgl. aber Finding 3 zur `.gitignore`-Lücke.
- **Wirksamkeit der Redaction** — der unauthentifiziert abrufbare `/api/run-log` auf prod (29.569 Bytes) enthält **keine** Klartext-Secrets: `ghp_`, `github_pat_`, `sk-ant-`, PEM-Header, JWT-Muster, Telegram-Bot-Token-Muster, Postgres-URLs **mit** Zugangsdaten und E-Mail-Adressen ergeben alle **0 Treffer**. `lib/worker-status.ts` und `lib/worker-loop.ts` filtern vor dem Schreiben. Die Disclosure aus Finding 1 bleibt gravierend, aber sie umfasst keine Zugangsdaten und keine personenbezogenen Daten.
- **Datenmodell / personenbezogene Daten** — `lib/schema.sql` speichert zu Personen nur opake IDs: kein Name, keine E-Mail, keine IP, kein User-Agent. Passkeys liegen als öffentlicher Schlüssel (das ist ihr Zweck) mit `counter` als Replay-Schutz, Backup-Codes nur als Hash (`code_hash`, beim Verbrauch auf `NULL`), Sessions als opake ID mit `expires_at`, Challenges kurzlebig mit `expires_at`. Datenschutzrechtlich ist hier fast keine Angriffsfläche.
- **Die drei Routen, die prüfen, prüfen richtig** — live mit dem Fake-Cookie auf beiden Umgebungen: `/api/auth/me` → `200 {"user":null}` (korrekt kein Nutzer), `/api/auth/backup-codes` → `401 {"error":"unauthorized"}`, `/api/auth/invitations` → `405` (Methode nicht erlaubt). Der Mechanismus (`lib/auth-request.ts` → `userIdForSession`) funktioniert; er ist nur fast nirgends angewandt.
- **Docker-/Compose-Hygiene** — Docker-Socket weiterhin nur im `health-agent` (`docker-compose.yml:182`), der keinen Port veröffentlicht und laut `agent/routes.ts` eine abgeschlossene Liste von Operationen annimmt. Kein Host-Root-Mount — nur `/proc:/host/proc:ro` (Zeile 107), mit dokumentierter Begründung aus bug-005. Der `db`-Dienst veröffentlicht keinen Port; einziger veröffentlichter Port ist `${APP_PORT}:3000` (vgl. Finding 1).
- **Deploy-Workflow** — läuft nur auf `push` für `branches: [dev, main]`, nicht auf `pull_request`; kein Fork-Zugriff auf den self-hosted Runner (`runs-on: [self-hosted, appbaua]`). Die env-Datei wird vom Host (`$HOME/appbaua-env/`) gelesen, nicht aus dem Checkout. Test-Gate (`lint`, `typecheck`, `test`) läuft vor dem Deploy.
- **Ausfallwächter beim Webhoster** (`watchdog/`) — unverändert: beide öffentlichen Endpunkte verlangen die Kennung, der Vergleich läuft timing-safe über `hash_equals` (`watchdog/private/watchdog.php:349`, mit Begründung in Zeile 340), das Geheime liegt außerhalb des Web-Verzeichnisses und ist korrekt in `.gitignore:39-40` erfasst (`config.php` **und** `state.json`). `config.sample.php` enthält nur Platzhalter.
- **Kein Brute-Force-Schutz auf `/login` und `/recovery`** — erneut geprüft, erneut nicht als Finding geführt. In `lib/auth-*.ts` und `app/api/auth/` gibt es keinen Versuchszähler, kein Lockout, kein 429 (`lib/rate-limit.ts` ist trotz des Namens die Behandlung von Claude-API-Limits). Backup-Codes haben aber 80 Bit Entropie (`randomBytes(10)`), und Passkeys sind nicht erratbar — Brute-Force ist auch ungebremst nicht praktikabel. Relevant würde das erst, wenn je ein ratbarer Faktor hinzukäme.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, „Always Use HTTPS", Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), ob `APP_PORT` am Router offen liegt, Cronjob-Einrichtung des Wächters beim Hoster, Dateirechte der tatsächlichen `~/appbaua-env/*.env`, tatsächlich gesetzte `APP_ORIGIN`-Werte je Umgebung. (`curl` fehlt in diesem Container; die Live-Abrufe liefen über `fetch` in Node.)

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer genau darf zugreifen" und „welche Backup-Erwartung gilt" sind nirgends festgeschrieben — Finding 4 lässt sich ohne dieses SOLL nicht abschließen. Der Skill `setup-security` legt die Datei an.

**Kein Eingriff während dieser Prüfung.** `git status --porcelain` ist nach Abschluss leer, `HEAD` unverändert bei `abbe47a`; alle Manifest-Kopien lagen unter `/tmp`. Gegen die Live-Umgebungen liefen ausschließlich `GET`-Anfragen, kein Schreibpfad wurde angefragt.
