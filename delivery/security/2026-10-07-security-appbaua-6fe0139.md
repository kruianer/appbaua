---
type: security
repo: AppBaua
commit: 6fe0139
date: 2026-10-07
---

# Security: AppBaua (6fe0139)

Automatisch erstellt vom appbaua-Worker am 2026-10-07.

Prüfung abgeschlossen. Keine Datei und keine Konfiguration im Repo wurde angefasst — alle Hilfsprüfungen liefen auf Kopien unter `/tmp`, alle Live-Abrufe waren ausschließlich `GET`.

---
type: security
repo: AppBaua
commit: 6fe0139
date: 2026-10-07
---

# Security: appbaua (6fe0139)

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen das aus `delivery/devops.md` und `CLAUDE.md` ableitbare SOLL (beide Umgebungen bewusst öffentlich über Cloudflare Tunnel, Passkey-Zugangsschutz nach req-023, HTTPS als dokumentierte Origin-Form, zusätzlich WLAN-Zugang über `APP_PORT`) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte Kernbefund — **ein frei erfundener Session-Cookie genügt für vollen Zugriff** — besteht **unverändert** fort, zum **neunten Mal in Folge**, heute erneut live belegt auf `dev.appbaua.com` **und** `app.appbaua.com`. Nach wie vor prüfen nur **3 von 33** Route-Handlern die Session; am Code hat sich seit dem Vorbericht **nichts** geändert (die drei Commits seit `4b84e3e` fügen ausschließlich Markdown unter `delivery/` hinzu). `delivery/requirements/ready/` und `delivery/bugs/ready/` sind weiterhin **leer** — es existiert kein Arbeitspaket für die Lücke. Daneben unverändert: kein HTTPS-Zwang, keine Security-Header, keine Backup-Strategie, `deploy/*.env` nicht ignoriert. Bei den Abhängigkeiten ist ein **fünftes** Advisory hinzugekommen (`source-map-js`), und erstmals ist ein **vollständig wirksamer Behebungsweg verifiziert**: `next@^16.4.0` plus ein Update von `nanoid`/`source-map-js` führt auf **0 Advisories**. Keine Secrets im Repo oder in der Git-Historie; die Redaction wirkt.

**Abweichend vom Vorbericht wurde diesmal kein einziger Schreibpfad angefragt** — auch nicht mit ungültigem Body. Der Vorbericht hat damit versehentlich den Hauptschalter der Produktion umgelegt; der Beweiswert war einmalig und rechtfertigt keine Wiederholung. Die schreibende Reichweite unten ist daher aus dem Code erschlossen und stützt sich auf den dokumentierten Live-Beleg vom 2026-09-30.

---

## 1. Gefälschter Session-Cookie genügt für vollen Zugriff — auf dev UND prod (hoch)

`middleware.ts:38` prüft ausschließlich, ob der Cookie `appbaua_session` überhaupt einen Wert hat (`Boolean(request.cookies.get(SESSION_COOKIE)?.value)`), nicht ob dieser Wert einer existierenden Session entspricht. Von **33** Route-Handlern unter `app/api/` rufen weiterhin nur **drei** `currentUser()` auf (`auth/backup-codes`, `auth/invitations`, `auth/me`); zehn weitere sind der legitim öffentliche Auth-Bereich, die verbleibenden **20 validieren nichts**.

**Heute live verifiziert** mit `Cookie: appbaua_session=security-check-2026-10-07-never-issued` — einem Wert, der nie ausgestellt wurde:

```
dev  GET /api/repos          ohne=401        fake=200 [139B]   {"repos":[{"id":"r17849250898901","name":"appbaua",…
dev  GET /api/github-repos   ohne=401        fake=200 [1783B]  private Repo-Liste des Betreibers
dev  GET /api/run-log        ohne=401        fake=200 [7755B]  Verlaufseinträge
dev  GET /api/task-types     ohne=401        fake=200 [2488B]  komplette Zeitplanung
dev  GET /api/system-metrics ohne=401        fake=200 {"disk":{"freeBytes":217437413376,…
dev  GET /                   ohne=307→/login fake=200 [16.980B] gerenderte Steuerungsoberfläche
prod GET /api/repos          ohne=401        fake=200 [1324B]  {"repos":[{"name":"LivingGardenTwin",…
prod GET /api/github-repos   ohne=401        fake=200 [1783B]  private Repo-Liste des Betreibers
prod GET /api/run-log        ohne=401        fake=200 [31.335B] Verlaufseinträge
prod GET /api/worker-status  ohne=401        fake=200 [6121B]  {"phase":"running","currentRepo":"AppBaua",…
prod GET /api/health         ohne=401        fake=200 [5073B]  {"apps":[{"lamp":"green","detail":"8 Container laufen",…
prod GET /api/system-metrics ohne=401        fake=200 {"disk":{"freeBytes":217428201472,…
prod GET /                   ohne=307→/login fake=200 [18.382B] gerenderte Steuerungsoberfläche
```

`app/page.tsx:9-20` lädt `listRepos()`, `listTaskTypes()` und `getWorkerState()` ohne jede Session-Prüfung. Der Kommentar in `middleware.ts:4-12`, die echte Prüfung finde „in den Auth-API-Routen und Page-Server-Components" statt, ist für beide genannten Orte nachweislich falsch — und zwar unverändert seit neun Wochen.

**Schreibende Reichweite** (aus dem Code erschlossen; der Pfad `PUT /api/worker-state` wurde am 2026-09-30 versehentlich live belegt und hat damals den prod-Hauptschalter umgelegt):

| Route | Wirkung |
|---|---|
| `PUT /api/worker-state` | hält den Worker der Produktion an. `app/api/worker-state/route.ts:11` wertet `!!body.enabled` aus — ein leerer Body `{}` bedeutet `false` und wird ohne Validierung geschrieben |
| `POST /api/repos/[id]/appbaua` | klont ein fremdes Repo und pusht auf dessen `dev`-Branch (req-012, Token mit Schreibrecht) |
| `POST /api/health/restart` | startet einen Container einer überwachten App neu — **begrenzt**: `lib/health-service.ts:181-186` lässt nur Container zu, die zu einem `monitored` Repo passen |
| `POST /api/health/analyze` | lässt appbaua den KI-Schlüssel einer anderen App aus deren Container lesen (`lib/log-analysis-service.ts:110-169`) und verbraucht fremdes Kontingent |
| `DELETE /api/repos/[id]`, `DELETE /api/run-log` | löscht Repos bzw. den gesamten Verlauf |
| `PATCH/PUT /api/task-types/*`, `PUT /api/health/settings` | Zeitpläne und Überwachungseinstellungen |

Hinzu kommt: der App-Container veröffentlicht laut `docker-compose.yml:108-109` zusätzlich `${APP_PORT}:3000` ohne TLS. Auf diesem Weg ist dieselbe Lücke im WLAN auch im Klartext erreichbar — das Cookie ist zwar `Secure` und würde vom Browser dort nicht gesendet, ein manuell gesetzter Header unterliegt dieser Einschränkung aber nicht.

**Empfehlung:** Ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender **oder ungültiger** Session 401 liefert, angewandt auf **jeden** nicht-öffentlichen Route-Handler; für die Seiten zusätzlich eine `currentUser()`-Prüfung mit Redirect in `app/page.tsx` bzw. im Layout. Der irreführende Kommentar in `middleware.ts:4-12` ist mitzukorrigieren. Zweitens: `PUT /api/worker-state` sollte einen fehlenden `enabled`-Wert mit `400` abweisen statt ihn als `false` zu schreiben. Das ist mit deutlichem Abstand der wichtigste offene Punkt des Repos. Entscheidend ist dabei weniger die technische Lösung — die ist seit neun Berichten dieselbe und unstrittig — als dass daraus ein **Arbeitspaket** wird: ohne eine Datei in `delivery/bugs/ready/` greift der Worker den Punkt nie auf, und dieser Bericht wiederholt ihn in Woche zehn erneut.

**Verifikation:** Lesepfade live gegen `dev.appbaua.com` und `app.appbaua.com` (ausschließlich `GET`), Schreibpfade aus Code erschlossen + Live-Beleg des Vorberichts, dazu Codeabgleich (`git diff 4b84e3e..HEAD` berührt keinen Code).

## 2. HTTPS wird auf keiner der beiden Zonen erzwungen, keine Security-Header (mittel)

```
http://dev.appbaua.com/login  → 200, kein Redirect
http://app.appbaua.com/login  → 200, kein Redirect
https://dev.appbaua.com/login → 200
https://app.appbaua.com/login → 200
HSTS / CSP / X-Frame-Options / X-Content-Type-Options / Referrer-Policy: auf allen vier NICHT GESETZT
```

Unverändert gegenüber neun Vorberichten. Das Session-Cookie ist `Secure` und WebAuthn verlangt ohnehin einen Secure Context — aber jede Anfrage, bei der nicht ausdrücklich `https://` eingegeben wird, geht zunächst im Klartext hinaus, und es folgt kein Upgrade. `next.config.ts` enthält keinen `headers()`-Block; der Schutz hinge also selbst nach einer Dashboard-Umstellung allein an Cloudflare.

**Empfehlung:** „Always Use HTTPS" im Cloudflare-Dashboard für beide Zonen aktivieren **und** `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht an einer einzelnen Dashboard-Einstellung hängt. `X-Frame-Options: DENY` (oder `frame-ancestors 'none'`) und `X-Content-Type-Options: nosniff` im selben Zug — die Steuerungsoberfläche gehört in keinen fremden Frame.

**Verifikation:** live (HTTP- und HTTPS-Abruf heute gegen beide Umgebungen, Header ausgelesen) + Code (`next.config.ts`).

## 3. Dokumentierter Pfad für die env-Dateien ist nicht ignoriert — der Worker committet mit `git add -A` (niedrig)

`docker-compose.yml:4-7` und `delivery/devops.md:24,53-56,79-81,117-118` nennen `deploy/dev.env` / `deploy/prod.env` als Ort der Geheimnisse (`GITHUB_TOKEN`, DB-Passwort, `CLOUDFLARE_TUNNEL_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WATCHDOG_TOKEN`) und versichern mehrfach, diese Dateien seien „bewusst nicht versioniert". Das trifft nicht zu:

```
git check-ignore -v deploy/dev.env   → NOT IGNORED
git check-ignore -v deploy/prod.env  → NOT IGNORED
git check-ignore -v .env             → .gitignore:23
```

`.gitignore:23` enthält nur `.env` (trifft ausschließlich den Basename) und `.env*.local`; ein Verzeichnis `deploy/` mit `*.env` ist von keinem Muster erfasst. Verschärfend: `lib/workspace.ts:887` committet mit `git add -A` — wer der Dokumentation folgt und die Datei am genannten Ort anlegt, hat sie beim nächsten Worker-Lauf im Repo. `.dockerignore` deckt `.env`/`.env.*` ab, `deploy/` ebenfalls nicht.

**Warum trotzdem nur „niedrig":** Die reale Installation weicht von der Doku ab — `.github/workflows/deploy.yml` legt die Dateien unter `~/appbaua-env/*.env` ab, also außerhalb jeder Arbeitskopie. Es liegt heute nichts offen; die Lücke ist eine Falle, keine aktive Preisgabe. Die Historienprüfung bestätigt das: `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei **nur** `.env.example`, und dort hat kein einzelner Schlüssel einen Wert (`grep -E '^[A-Z_]+=.+'` bleibt leer).

**Empfehlung:** Zwei Zeilen, die die Falle schließen: `deploy/` und `*.env` (mit `!.env.example`) in `.gitignore`. Parallel den Pfad in `docker-compose.yml` und `delivery/devops.md` auf den tatsächlich verwendeten `~/appbaua-env/` korrigieren, damit Doku und Installation dasselbe sagen.

**Verifikation:** aus Code/Config erschlossen (`git check-ignore` und `git log` gegen den realen Stand ausgeführt, keine Dateien angelegt oder verändert).

## 4. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` existiert keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo gibt es weiterhin keinen Dump-/Snapshot-/Restore-Mechanismus: die Suche nach `pg_dump|pg_restore|wal-g|pgbackrest|restic|borgbackup|barman` über den gesamten getrackten Bestand liefert Treffer **nur** in `delivery/idea/backup-mit-restore-drill-nachweis.md` — also einem Vorschlag, keiner Umsetzung — und in früheren Sicherheitsberichten. Das `db-data`-Volume ist ungesichert, `.github/workflows/deploy.yml` enthält keinen Backup-Schritt. (Abzugrenzen von req-031 — Backup-Codes sind Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; die vorliegende Idee `backup-mit-restore-drill-nachweis.md` ist der passende Umsetzungsweg. Ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen — er steht jetzt im siebten Bericht.

**Verifikation:** aus Code/Config erschlossen.

## 5. `npm audit`: jetzt 5 Advisories (1 kritisch, 4 hoch) — `npm audit fix` behebt null, der wirksame Weg ist verifiziert (niedrig)

`npm audit --omit=dev`: **5** Advisories, eines mehr als im Vorbericht. Neu ist **`source-map-js` 1.2.1** (GHSA-68fv-2mgg-jv7q, Event-Loop-DoS über indizierte Source-Map-Offsets); es hängt über `postcss` am `next`-Strang, an dem auch die übrigen vier hängen.

| Paket | Installiert | Verwundbarer Bereich | Bewertung hier |
|---|---|---|---|
| `next` | 15.5.21 | `9.3.4-canary.0 – 16.3.0-preview.10` | **GHSA-p293-qw3h-jr36** (unauth. RCE) betrifft ausdrücklich nur **Windows-gehostete** Server — dieses Repo läuft auf einem Ubuntu-Beelink. **GHSA-2xp9-vwfh-vxw4** (RCE über die Image-Optimization-API bei AVIF) setzt `next/image` voraus — kein Treffer in `app/`, `components/`, `lib/`, und `next.config.ts` hat keinen `images`-Block. |
| `postcss` | 8.4.31 | `<=8.5.22` | vier `sourceMappingURL`-Advisories plus GHSA-qx2v-qp2m-jg93 (XSS über unescaptes `</style>`), nur über Build-Zeit-CSS erreichbar. |
| `sharp` | 0.34.5 | `<=0.35.5-rc.1` | geerbte libvips-/libheif-/librsvg-CVEs; nur über den ungenutzten `next/image`-Pfad erreichbar. Der Bereich ist seit dem Vorbericht erneut gewachsen (vorher `<=0.35.4-rc.0`). |
| `nanoid` | 3.3.16 | `<3.3.18` | Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen. |
| `source-map-js` | 1.2.1 | `1.0.0 – 1.2.1` | **neu**; DoS nur beim Parsen einer Source Map, also zur Build-Zeit. |

**`npm audit fix` ist unverändert wirkungslos** — und zwar, obwohl die Ausgabe bei allen fünf Einträgen „fix available via `npm audit fix`" behauptet. In einer Kopie von `package.json`/`package-lock.json` unter `/tmp` geprüft (`npm audit fix --dry-run --package-lock-only`, nichts installiert oder im Repo geschrieben) bleiben **alle fünf Versionen exakt gleich** und die Bilanz danach bei 5 Advisories. Ursache: `next` 15 pinnt `postcss` hart auf `8.4.31` und begrenzt `sharp` auf `^0.34.3`.

**Der wirksame Weg ist diesmal vollständig verifiziert.** In einer zweiten `/tmp`-Kopie mit `next: "^16.4.0"` und `eslint-config-next: "^16.4.0"`, aufgelöst per `npm install --package-lock-only`:

```
next 16.4.0  postcss 8.5.23  sharp 0.35.5  nanoid 3.3.16  source-map-js 1.2.1   → 2 high
```

`next` 16.4.0 löst drei der fünf (`next` selbst, `postcss` auf 8.5.23 > 8.5.22, `sharp` auf 0.35.5 > 0.35.5-rc.1). `nanoid` und `source-map-js` bleiben zunächst stehen, weil die alten Einträge die neuen Ranges (`^3.3.16`, `^1.2.1`) formal noch erfüllen — das Lockfile behält sie. Ein nachgeschobenes `npm update nanoid source-map-js` hebt sie auf 3.3.20 bzw. 1.2.2:

```
next 16.4.0  postcss 8.5.23  sharp 0.35.5  nanoid 3.3.20  source-map-js 1.2.2  → found 0 vulnerabilities
```

**Empfehlung:** Den Upgrade auf `next` 16 als eigenes Arbeitspaket einplanen, **mit dem `npm update nanoid source-map-js` als zweitem Schritt** — ohne ihn bleiben zwei Advisories stehen, und das ist der Punkt, an dem ein Upgrade-Versuch sonst als „hat nichts gebracht" abgebrochen würde. Die Test-Suite (`npm test`, `lint`, `typecheck` im Deploy-Workflow) deckt die Regression ab; `eslint-config-next` muss mitwandern. Die praktische Angriffsvoraussetzung fehlt heute weiterhin (Linux-Host, kein `next/image`) — das rechtfertigt „niedrig" trotz „kritisch" im Advisory. Sollte `next/image` künftig eingeführt werden, wird GHSA-2xp9-vwfh-vxw4 sofort relevant, dann ist das Upgrade vorzuziehen. `npm audit fix` sollte **nicht** als Maßnahme geführt werden; seine eigene Erfolgsmeldung ist hier irreführend.

**Verifikation:** live (`npm audit` gegen den Repo-Stand; `npm audit fix --dry-run` sowie die vollständige `next`-16-Auflösung auf Manifest-Kopien in `/tmp`, mit Versionsvergleich vor/nach; `npm view` für veröffentlichte Versionen und Abhängigkeitsbereiche) + Code-Grep (kein `next/image`) + Host-OS aus `devops.md`.

---

**Geprüft und unauffällig:**

- **Code-Delta seit `4b84e3e`** — die drei Commits (`79274df`, `aa5e9b9`, `6fe0139`) fügen ausschließlich Markdown unter `delivery/` hinzu: den Vorbericht, eine Idee und einen Code-Review. Kein Code, keine Config, keine Abhängigkeit berührt. Folge: Findings 1–4 sind nicht nur sinngemäß, sondern Zeile für Zeile identisch zum Vorbericht.
- **Secrets im Repo und in der gesamten Git-Historie** — `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-/Key-Datei nur `.env.example`, dort ohne einen einzigen gesetzten Wert. Treffer auf `ghp_`/`github_pat_`/`sk-ant-` liegen ausschließlich in `lib/redact.ts` (Erkennungsmuster) und in `lib/*.test.ts` (synthetische Fixtures, erkennbar an `A1b2C3d4…`). Keine privaten Schlüssel, keine AWS-IDs. Vgl. aber Finding 3 zur `.gitignore`-Lücke.
- **Wirksamkeit der Redaction** — der unauthentifiziert abrufbare `/api/run-log` auf prod (31 KB) enthält **keine** Klartext-Secrets: `ghp_`, `github_pat_`, `sk-ant-`, PEM-Header und JWT-Muster bleiben alle leer. `lib/worker-status.ts` und `lib/worker-loop.ts` filtern vor dem Schreiben. Die Disclosure aus Finding 1 bleibt gravierend, aber sie umfasst keine Zugangsdaten.
- **Datenmodell / personenbezogene Daten** — `lib/schema.sql:154-215` speichert zu Personen nur opake IDs: kein Name, keine E-Mail, keine IP, kein User-Agent. Passkeys liegen als öffentlicher Schlüssel (das ist ihr Zweck) mit `counter` als Replay-Schutz, Backup-Codes nur als Hash (`code_hash`, beim Verbrauch auf `NULL`), Sessions als opake ID mit `expires_at`, Challenges kurzlebig. Datenschutzrechtlich ist hier fast keine Angriffsfläche.
- **Die drei Routen, die prüfen, prüfen richtig** — mit dem Fake-Cookie liefert `/api/auth/me` korrekt `{"user":null}` statt eines Nutzers. Der Mechanismus (`lib/auth-request.ts` → `userIdForSession`) funktioniert; er ist nur fast nirgends angewandt.
- **Docker-/Compose-Hygiene** — Docker-Socket weiterhin nur im `health-agent`, der keinen Port veröffentlicht und laut `agent/routes.ts` eine abgeschlossene Liste von Operationen annimmt (auflisten, eine env-Variable, exec, logs, restart). Kein Host-Root-Mount — nur `/proc:/host/proc:ro`, mit dokumentierter Begründung aus bug-005. Der `db`-Dienst veröffentlicht keinen Port. `cloudflared` erhält seinen Token nur über die env-Datei.
- **Deploy-Workflow** — läuft nur auf `push` für `[dev, main]`, nicht auf `pull_request`; kein Fork-Zugriff auf den self-hosted Runner. `concurrency` pro Ref ohne `cancel-in-progress`. Die env-Datei wird vom Host (`$HOME/appbaua-env/`) gelesen, nicht aus dem Checkout. Test-Gate (`lint`, `typecheck`, `test`) läuft vor dem Deploy.
- **Ausfallwächter beim Webhoster** (`watchdog/`) — unverändert: beide öffentlichen Endpunkte verlangen die Kennung, der Vergleich läuft timing-safe über `hash_equals`, das Geheime liegt außerhalb des Web-Verzeichnisses und ist korrekt in `.gitignore:39-40` erfasst (`config.php` **und** `state.json`).
- **Kein Brute-Force-Schutz auf `/login` und `/recovery`** — erneut geprüft, erneut nicht als Finding geführt. In `lib/auth-*.ts` und `app/api/auth/` gibt es keinen Versuchszähler, kein Lockout, kein 429 (`lib/rate-limit.ts` ist trotz des Namens die Behandlung von Claude-API-Limits). Backup-Codes haben aber 80 Bit Entropie (`randomBytes(10)`), und Passkeys sind nicht erratbar — Brute-Force ist auch ungebremst nicht praktikabel. Relevant würde das erst, wenn je ein ratbarer Faktor hinzukäme.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, „Always Use HTTPS", Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), ob `APP_PORT` am Router offen liegt, Cronjob-Einrichtung des Wächters beim Hoster, Dateirechte der tatsächlichen `~/appbaua-env/*.env`, tatsächlich gesetzte `APP_ORIGIN`-Werte je Umgebung.

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer genau darf zugreifen" und „welche Backup-Erwartung gilt" sind nirgends festgeschrieben — Finding 4 lässt sich ohne dieses SOLL nicht abschließen. Der Skill `setup-security` legt die Datei an.

**Kein Eingriff während dieser Prüfung.** Am Repo wurde nichts geändert; die Manifest-Kopien lagen unter `/tmp`. Gegen die Live-Umgebungen liefen ausschließlich `GET`-Anfragen — anders als beim Vorbericht wurde kein Schreibpfad angefragt, auch nicht mit ungültigem Body.
