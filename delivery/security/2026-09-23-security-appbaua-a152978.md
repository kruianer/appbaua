---
type: security
repo: AppBaua
commit: a152978
date: 2026-09-23
---

# Security: AppBaua (a152978)

Automatisch erstellt vom appbaua-Worker am 2026-09-23.

Alle Bereiche geprüft, mehrere Findings live gegen dev und prod verifiziert. Hier der Bericht.

---

# Security: appbaua (a152978)

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen die aus `delivery/devops.md` und `CLAUDE.md` ableitbaren Vorgaben (beide Umgebungen bewusst öffentlich über Cloudflare Tunnel, Passkey-Zugangsschutz nach req-023, HTTPS als dokumentierte Origin-Form) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte Kernbefund — **ein frei erfundener Session-Cookie genügt für vollen Zugriff** — besteht **unverändert** fort und wurde heute zum siebten Mal in Folge live bestätigt, wieder auf `dev.appbaua.com` **und** `app.appbaua.com`; der Code an `middleware.ts`, `lib/auth-request.ts`, `app/api/` und `app/page.tsx` ist seit `280b62a` unangetastet (das einzige Code-Delta ist bug-022 in `lib/worker-loop.ts`, sicherheitsneutral). Neu belegt: `GET /api/github-repos` gibt mit demselben Fake-Cookie die **vollständige Liste der privaten GitHub-Repos des Betreibers** heraus — der PAT arbeitet für den Angreifer. Daneben unverändert: kein HTTPS-Zwang, kein HSTS (live bestätigt), keine Backup-Strategie. **Zwei Korrekturen am Vorbericht:** `deploy/*.env` ist entgegen dessen Aussage **nicht** von `.gitignore` erfasst (Finding 3), und von den vier `npm audit`-Advisories sind **zwei ohne Breaking Change behebbar**, nicht null (Finding 5). Keine Secrets im Repo oder in der Git-Historie.

---

## 1. Gefälschter Session-Cookie genügt für vollen, auch schreibenden Zugriff — auf dev UND prod (hoch)

`middleware.ts:38` prüft ausschließlich, ob der Cookie `appbaua_session` überhaupt gesetzt ist (`Boolean(request.cookies.get(...)?.value)`), nicht ob der Wert einer existierenden Session entspricht. Von **33** Route-Handlern unter `app/api/` rufen weiterhin nur **drei** (`auth/backup-codes`, `auth/invitations`, `auth/me`) `currentUser()` auf. Zehn weitere sind der legitim öffentliche Auth-Bereich (`/api/auth/login|bootstrap|recovery|logout|invitations/[token]`). Die verbleibenden **20 validieren nichts**.

**Live heute verifiziert** mit `Cookie: appbaua_session=totally-fake-nonexistent-value-xyz` — einem Wert, der nie ausgestellt wurde:

```
dev  GET /api/repos            ohne Cookie → 401   mit Fake-Cookie → 200 {"repos":[{"id":"r17849250898901","name":"appbaua",…
dev  GET /api/worker-state     ohne Cookie → 401   mit Fake-Cookie → 200 {"state":{"enabled":false}}
prod GET /api/repos            ohne Cookie → 401   mit Fake-Cookie → 200 {"repos":[{"name":"LivingGardenTwin",…
prod GET /api/worker-state     ohne Cookie → 401   mit Fake-Cookie → 200 {"state":{"enabled":true}}
prod GET /api/github-repos                         mit Fake-Cookie → 200 {"repos":[{"fullName":"kruianer/appbaua"},{"fullName":"kruianer/cellarvoice"},…
prod GET /api/health                               mit Fake-Cookie → 200 {"apps":[{"lamp":"green","checks":[{"detail":"8 Container laufen",…
prod GET /api/system-metrics                       mit Fake-Cookie → 200 {"disk":{"freeBytes":254506098688,…
prod GET /api/health/settings                      mit Fake-Cookie → 200 {"settings":{"intervalMinutes":5,"telegram":true,…
dev  GET /                                         mit Fake-Cookie → 200, 16.980 Bytes gerenderte Steuerungsoberfläche
prod GET /                                         mit Fake-Cookie → 200, 18.242 Bytes gerenderte Steuerungsoberfläche
```

`app/page.tsx:9-20` lädt `listRepos()`, `listTaskTypes()` und `getWorkerState()` ohne jede Session-Prüfung — der Kommentar in `middleware.ts:4-12`, die echte Prüfung finde „in den API-Routen und Page-Server-Components" statt, ist für beide genannten Orte nachweislich falsch.

**Neu an diesem Lauf:** `GET /api/github-repos` ist der schwerwiegendste der Lesepfade. Er listet über den hinterlegten `GITHUB_TOKEN` die privaten Repositories des Betreibers auf — der Angreifer bekommt damit nicht nur appbaua-Daten, sondern die Inventarliste fremder Projekte.

**Schreibende Reichweite** (aus dem Code erschlossen; bewusst **nicht** gegen die laufenden Umgebungen ausgeführt) — unter den 20 ungeschützten Routen:

| Route | Wirkung |
|---|---|
| `POST /api/health/restart` | startet einen Container einer *anderen* überwachten App neu (via health-agent mit Docker-Socket) |
| `POST /api/repos/[id]/appbaua` | klont ein fremdes Repo und pusht auf dessen `dev`-Branch (req-012, Token mit Schreibrecht) |
| `POST /api/health/analyze` | schickt Container-Logs an den KI-Anbieter, verbraucht dessen Kontingent |
| `PUT /api/worker-state` | Hauptschalter des Workers |
| `DELETE /api/repos/[id]`, `DELETE /api/run-log` | löscht Repos bzw. den gesamten Verlauf |
| `PATCH/PUT /api/task-types/*`, `PUT /api/health/settings` | Zeitpläne und Überwachungseinstellungen |

**Empfehlung:** Ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender oder ungültiger Session 401 liefert, angewandt auf **jeden** nicht-öffentlichen Route-Handler; für die Seiten zusätzlich eine `currentUser()`-Prüfung mit Redirect in `app/page.tsx` bzw. im Layout. Der irreführende Kommentar in `middleware.ts:4-12` ist mitzukorrigieren. Das ist mit deutlichem Abstand der wichtigste offene Punkt dieses Repos — er liegt seit sieben Wochen unverändert offen und betrifft die Produktion.

**Verifikation:** live (nur lesend, heute gegen `dev.appbaua.com` und `app.appbaua.com`); Codeabgleich bestätigt Nulldiff an allen Auth-Pfaden seit `280b62a`. Die schreibende Reichweite ist aus dem Code erschlossen.

## 2. HTTPS wird auf keiner der beiden Zonen erzwungen, keine Security-Header (mittel)

```
http://dev.appbaua.com/login  → 200, kein Redirect
https://dev.appbaua.com/login → 200, HSTS: nicht gesetzt, CSP: nicht gesetzt, X-Frame-Options: nicht gesetzt
http://app.appbaua.com/login  → 200, kein Redirect
https://app.appbaua.com/login → 200, HSTS: nicht gesetzt, CSP: nicht gesetzt, X-Frame-Options: nicht gesetzt
```

Unverändert gegenüber sieben Vorberichten. Das Session-Cookie ist `Secure` und WebAuthn verlangt ohnehin einen Secure Context — aber jede Anfrage, bei der nicht ausdrücklich `https://` eingegeben wird, geht zunächst im Klartext hinaus, und es folgt kein Upgrade. `next.config.ts` enthält keinen `headers()`-Block, der Schutz hinge also selbst nach einer Dashboard-Umstellung allein an Cloudflare.

**Empfehlung:** „Always Use HTTPS" im Cloudflare-Dashboard für beide Zonen aktivieren **und** `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht an einer einzelnen Dashboard-Einstellung hängt. `X-Frame-Options: DENY` (oder `frame-ancestors 'none'`) im selben Zug — die Steuerungsoberfläche gehört in keinen fremden Frame.

**Verifikation:** live (HTTP- und HTTPS-Abruf heute gegen beide Umgebungen) + Code (`next.config.ts`).

## 3. Dokumentierter Pfad für die env-Dateien liegt im Repo und ist nicht ignoriert — der Worker committet mit `git add -A` (niedrig)

`docker-compose.yml:4-7` und `delivery/devops.md:24` nennen `deploy/dev.env` / `deploy/prod.env` als Ort der Geheimnisse (GITHUB_TOKEN, DB-Passwort, `CLOUDFLARE_TUNNEL_TOKEN`, `TELEGRAM_BOT_TOKEN`, `WATCHDOG_TOKEN`) und versichern jeweils, diese Dateien seien „bewusst nicht versioniert". Das trifft nicht zu:

```
git check-ignore -v deploy/dev.env   → NOT IGNORED
git check-ignore -v deploy/prod.env  → NOT IGNORED
git check-ignore -v .env                          → .gitignore:23
git check-ignore -v watchdog/private/config.php   → .gitignore:39
```

`.gitignore:23` enthält nur `.env` (trifft ausschließlich den Basename `.env`) und `.env*.local`. Ein Verzeichnis `deploy/` mit `*.env` ist von keinem Muster erfasst. Verschärfend: `lib/workspace.ts:698` committet mit `git add -A` — wer der Dokumentation folgt und die Datei am genannten Ort anlegt, hat sie beim nächsten Worker-Lauf im Repo.

**Warum trotzdem nur „niedrig":** Die reale Installation weicht von der Doku ab. `.github/workflows/deploy.yml:50-53` und `delivery/deploy-setup.md:59-95` legen die Dateien tatsächlich unter `~/appbaua-env/*.env` ab, also außerhalb jeder Arbeitskopie, mit `chmod 600`. Es liegt heute nichts offen — die Lücke ist eine Falle, keine aktive Preisgabe. Eine Historienprüfung bestätigt das: `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei nur `.env.example` (Template, alle Werte leer); die `ghp_…`-Treffer im Code liegen ausschließlich in `lib/redact.ts` als Erkennungsmuster und in `*.test.ts` als synthetische Fixtures.

**Empfehlung:** Zwei Zeilen, die die Falle schließen: `deploy/` und `*.env` (mit `!.env.example`) in `.gitignore`. Parallel den Pfad in `docker-compose.yml` und `delivery/devops.md` auf den tatsächlich verwendeten `~/appbaua-env/` korrigieren, damit Doku und Installation dasselbe sagen.

**Verifikation:** aus Code/Config erschlossen (`git check-ignore` gegen die reale `.gitignore` ausgeführt, keine Dateien angelegt oder verändert). Dies korrigiert die gegenteilige Aussage im Bericht vom 2026-09-16.

## 4. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` existiert keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo gibt es weiterhin keinen Dump-/Snapshot-/Restore-Mechanismus: die Suche nach `pg_dump|pg_restore|barman|wal-g|restic|borg` über den gesamten Tracked-Bestand liefert nur Treffer in `delivery/idea/backup-mit-restore-drill-nachweis.md` — also einen **Vorschlag**, keine Umsetzung. Das `db-data`-Volume ist ungesichert, `.github/workflows/deploy.yml` enthält keinen Backup-Schritt. (Abzugrenzen von req-031 — Backup-Codes sind Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; die bereits vorliegende Idee `backup-mit-restore-drill-nachweis.md` ist der passende Umsetzungsweg. Ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen — er steht jetzt im fünften Bericht.

**Verifikation:** aus Code/Config erschlossen.

## 5. `npm audit`: 1 kritische, 3 hohe transitive Advisories — zwei davon jetzt ohne Breaking Change behebbar (niedrig)

`npm audit --omit=dev`: 1 kritisch, 3 hoch. Installiert: `next@15.5.21`, `sharp@0.34.5`, `nanoid@3.3.16`, `postcss@8.4.31`.

| Paket | Schwere | Bewertung hier |
|---|---|---|
| `next` | kritisch | **GHSA-p293-qw3h-jr36** (unauth. RCE) betrifft ausdrücklich nur **Windows-gehostete** Server — dieses Repo läuft auf einem Ubuntu-Beelink. **GHSA-2xp9-vwfh-vxw4** (RCE über die Image-Optimization-API bei AVIF) setzt `next/image` voraus — kein Treffer in `app/`, `components/`, `lib/`. |
| `postcss` | hoch | vier `sourceMappingURL`-Advisories (Path Traversal, `.map`-Disclosure, XSS), nur über Build-Zeit-CSS erreichbar. |
| `sharp` | hoch | geerbte libvips-/libheif-CVEs; nur über den ungenutzten `next/image`-Pfad erreichbar. |
| `nanoid` | hoch | Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen. |

**Neu gegenüber dem Vorbericht** — dessen Aussage, alle vier seien nur über ein `next`-Major behebbar, gilt so nicht mehr. `npm audit fix --dry-run` (ohne `--force`, also innerhalb des bestehenden Semver-Bereichs) hebt `sharp 0.34.5 → 0.35.4` und `nanoid 3.3.16 → 3.3.19`; beide liegen damit **oberhalb** des jeweiligen verwundbaren Bereichs (`<=0.35.4-rc.0` bzw. `<3.3.18`) und sind erledigt. Die beiden verbleibenden hängen an `next`: `--force` hebt nur auf `15.5.26`, was innerhalb des Advisory-Bereichs `9.3.4-canary.0 – 16.3.0-preview.10` liegt, und `postcss` ist von `next` hart auf `8.4.31` gepinnt (`next/package.json`) — beides klärt erst ein Upgrade auf `next` 16.

**Empfehlung:** `npm audit fix` (ohne `--force`) ausführen und einchecken — zwei von vier Advisories verschwinden risikoarm, die Test-Suite deckt den Rest ab. Das kritische `next`-Advisory bleibt ohne praktische Angriffsvoraussetzung (Linux-Host, kein `next/image`) und wandert ins nächste geplante `next`-Major. Sollte `next/image` künftig eingeführt werden, wird GHSA-2xp9-vwfh-vxw4 sofort relevant — dann muss das Upgrade vorgezogen werden.

**Verifikation:** live (`npm audit` und `npm audit fix --dry-run` gegen die aktuelle `package-lock.json`; nichts installiert oder geschrieben) + Code-Grep (kein `next/image`) + Host-OS aus `devops.md`.

---

**Geprüft und unauffällig:**

- **Einziges Code-Delta seit `280b62a`** (`lib/worker-loop.ts`, bug-022: Pausen werden in 20-Sekunden-Scheiben abgewartet statt am Stück) — kein Auth-, Secret- oder Netzwerkbezug. Der Store-Lesefehler fällt bewusst auf „Pause bleibt stehen" zurück, statt sie zu verkürzen; das ist die sichere Richtung. Kein Fund.
- **Secrets im Repo und in der gesamten Git-Historie** — `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei nur `.env.example` (alle Werte leer). Treffer auf `ghp_`/`github_pat_`/`sk-` liegen ausschließlich in `lib/redact.ts` (Erkennungsmuster) und in `*.test.ts` (synthetische Fixtures). Vgl. aber Finding 3 zur `.gitignore`-Lücke.
- **Ausfallwächter beim Webhoster** (`watchdog/`) — beide öffentlichen Endpunkte verlangen die Kennung, der Vergleich läuft timing-safe über `hash_equals`, Fehlerantworten verraten die Ursache nicht, das Geheime liegt außerhalb des Web-Verzeichnisses und ist korrekt in `.gitignore:39`.
- **Docker-/Compose-Hygiene** — Docker-Socket weiterhin nur im `health-agent`, der keinen Port veröffentlicht und nur vier Operationen annimmt; kein Host-Root-Mount (nur `/proc:ro`); der `db`-Dienst veröffentlicht keinen Port.
- **Deploy-Workflow** — läuft nur auf `push` für `[dev, main]`, nicht auf `pull_request`; kein Fork-Zugriff auf den self-hosted Runner. Die env-Datei wird vom Host gelesen, nicht aus dem Checkout.
- **Recovery-Endpunkt ohne Rate-Limit** — erneut bewertet und verworfen: Backup-Codes haben 80 Bit Entropie (`randomBytes(10)`), Brute-Force ist auch ungebremst nicht praktikabel.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), Cronjob-Einrichtung des Wächters beim Hoster, Dateirechte der tatsächlichen `~/appbaua-env/*.env`.

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer genau darf zugreifen" und „welche Backup-Erwartung gilt" sind nirgends festgeschrieben — Finding 4 lässt sich ohne dieses SOLL nicht abschließen. Der Skill `setup-security` legt die Datei an.

---

Am Repo wurde nichts geändert; alle Prüfungen waren lesend, die Live-Abrufe ausschließlich GET.
