---
type: security
repo: AppBaua
commit: 280b62a
date: 2026-09-16
---

# Security: AppBaua (280b62a)

Automatisch erstellt vom appbaua-Worker am 2026-09-16.

---
type: security
repo: appbaua
commit: 280b62a
date: 2026-09-16
---

# Security: appbaua (280b62a)

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen die aus `delivery/devops.md` und `CLAUDE.md` ableitbaren Vorgaben (beide Umgebungen bewusst öffentlich über Cloudflare Tunnel, Passkey-Zugangsschutz nach req-023, HTTPS-Pflicht) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte Kernbefund — **ein frei erfundener Session-Cookie genügt für vollen Zugriff** — besteht **unverändert** fort und wurde heute erneut live gegen `dev.appbaua.com` **und `app.appbaua.com` (Produktion)** bestätigt; `git diff 908c7e2..HEAD -- middleware.ts lib/auth-request.ts app/api` ist leer. Neu belegt: auch die Dashboard-Seite selbst (`app/page.tsx`) prüft die Session nicht — damit ist die Behauptung im Kommentar von `middleware.ts:4-12`, die echte Prüfung finde „in den API-Routen und Page-Server-Components" statt, für beide genannten Orte widerlegt. Daneben unverändert: HTTPS wird an keiner der beiden Zonen erzwungen, kein HSTS (live bestätigt), keine Backup-Strategie für die Postgres-Daten, und `npm audit` meldet 1 kritische + 3 hohe transitive Advisories (Angriffsvoraussetzungen liegen hier nicht vor). Keine Secrets im Repo oder in der Git-Historie. Das einzige sicherheitsrelevante Delta seit dem letzten Bericht — das neue persistente `worker-work:/work`-Volume — ist **unkritisch** (siehe „Geprüft und unauffällig").

---

## 1. Gefälschter Session-Cookie genügt für vollen, auch schreibenden Zugriff — auf dev UND prod (hoch)

`middleware.ts:38` prüft ausschließlich, ob der Cookie `appbaua_session` überhaupt gesetzt ist (`Boolean(request.cookies.get(...)?.value)`), nicht ob der Wert einer existierenden Session entspricht. Von **33** Route-Handlern unter `app/api/` rufen weiterhin nur **drei** (`auth/backup-codes`, `auth/invitations`, `auth/me`) `currentUser()` aus `lib/auth-request.ts` auf. Die verbleibenden 30 validieren nichts.

**Live heute verifiziert** mit `Cookie: appbaua_session=totally-fake-nonexistent-value-xyz` — ein Wert, der nie ausgestellt wurde:

```
dev  GET /api/repos          ohne Cookie → 401   mit Fake-Cookie → 200 {"repos":[{"id":"r17849250898901","name":"appbaua",…
dev  GET /api/task-types     ohne Cookie → 401   mit Fake-Cookie → 200 {"types":[…
dev  GET /api/worker-state   ohne Cookie → 401   mit Fake-Cookie → 200 {"state":{"enabled":false}}
dev  GET /api/run-log        ohne Cookie → 401   mit Fake-Cookie → 200 {"entries":[…
dev  GET /api/system-metrics ohne Cookie → 401   mit Fake-Cookie → 200 {"disk":{"freeBytes":286928052224,…
prod GET /api/repos          ohne Cookie → 401   mit Fake-Cookie → 200 {"repos":[{"name":"LivingGardenTwin",…
prod GET /api/worker-state   ohne Cookie → 401   mit Fake-Cookie → 200 {"state":{"enabled":true}}
```

Zusätzlich neu belegt: `GET https://dev.appbaua.com/` liefert mit demselben Fake-Cookie **HTTP 200 und die vollständig gerenderte Steuerungsoberfläche** (16.980 Bytes, enthält `kruianer/appbaua`). `app/page.tsx` lädt `listRepos()`, `listTaskTypes()` und `getWorkerState()` ohne jede Session-Prüfung — es gibt dort keinen zweiten Gate, auf den der Kommentar in `middleware.ts` verweist.

**Schreibende Reichweite** (aus dem Code erschlossen; bewusst **nicht** gegen die laufenden Umgebungen ausgeführt): unter den 30 ungeschützten Routen sind `POST /api/health/restart` (startet einen Container einer *anderen* überwachten App neu — `restartAppContainer`, via health-agent mit Docker-Socket), `POST /api/health/analyze` (schickt Container-Logs an den KI-Anbieter, verbraucht dessen Schlüssel), `POST/PATCH /api/worker-state`, `/api/task-types/*`, `/api/repos/*` sowie das Löschen des Verlaufs. Wer die URL kennt, kann den Worker steuern und fremde Container neu starten.

**Empfehlung:** Ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender oder ungültiger Session 401 liefert, angewandt auf **jeden** nicht-öffentlichen Route-Handler; für die Seiten zusätzlich eine `currentUser()`-Prüfung mit Redirect in `app/page.tsx` (bzw. im Layout). Der irreführende Kommentar in `middleware.ts:4-12` ist mit zu korrigieren. Das ist mit deutlichem Abstand der wichtigste offene Punkt dieses Repos — er liegt seit sechs Wochen unverändert offen und betrifft auch die Produktion.

**Verifikation:** live (nur lesend, heute gegen `dev.appbaua.com` und `app.appbaua.com`); Codeabgleich bestätigt Nulldiff seit `908c7e2`.

## 2. HTTPS wird auf keiner der beiden Zonen erzwungen, kein HSTS (mittel)

```
http://dev.appbaua.com/login  → 200, kein Redirect
https://dev.appbaua.com/login → 200, Strict-Transport-Security: nicht gesetzt
http://app.appbaua.com/login  → 200, kein Redirect
https://app.appbaua.com/login → 200, Strict-Transport-Security: nicht gesetzt
```

Unverändert gegenüber sechs Vorberichten, und heute erstmals für beide Umgebungen zusammen belegt. Das Session-Cookie ist `Secure` und WebAuthn verlangt ohnehin einen Secure Context — aber jede Anfrage, bei der nicht ausdrücklich `https://` eingegeben wird, geht zunächst im Klartext hinaus, und es folgt kein Upgrade.

**Empfehlung:** „Always Use HTTPS" im Cloudflare-Dashboard für beide Zonen aktivieren **und** `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht allein an einer Dashboard-Einstellung hängt.

**Verifikation:** live (HTTP- und HTTPS-Abruf heute gegen beide Umgebungen).

## 3. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` existiert keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo gibt es weiterhin keinen Dump-/Snapshot-/Restore-Mechanismus: `grep -rn "pg_dump\|backup\|restore\|snapshot"` über `.github/`, `docker-compose.yml` und `lib/schema.sql` liefert nur Treffer zu den Login-Backup-Codes. Das `db-data`-Volume ist ungesichert, `.github/workflows/deploy.yml` enthält keinen Backup-Schritt. (Abzugrenzen von req-031 — Backup-Codes sind Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen.

**Verifikation:** aus Code/Config erschlossen.

## 4. `npm audit`: 1 kritische, 3 hohe transitive Advisories — Voraussetzungen liegen hier nicht vor (niedrig)

`npm audit --omit=dev`: 1 kritisch, 3 hoch, unverändert gegenüber dem Vorbericht.

- **`next`, kritisch** — **GHSA-p293-qw3h-jr36** (unauth. RCE) betrifft ausdrücklich nur **Windows-gehostete** Server; dieses Repo läuft laut `delivery/devops.md` auf einem Ubuntu-Beelink. **GHSA-2xp9-vwfh-vxw4** (RCE über die Image-Optimization-API bei AVIF) setzt `next/image` voraus — kein Treffer in `app/`, `components/`, `lib/`.
- **`postcss`, hoch** — vier Advisories zu `sourceMappingURL` (Path Traversal, Arbitrary `.map`-File-Disclosure, XSS über unescaped `</style>`), nur über Build-Zeit-CSS erreichbar.
- **`sharp`, hoch** — geerbte libvips-/libheif-CVEs; nur über den ungenutzten Image-Pfad erreichbar.
- **`nanoid`, hoch** — Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen.

Alle vier sind transitiv über `next` und laut `npm audit` nur über ein `next`-Major-Upgrade (Breaking Change) behebbar.

**Empfehlung:** Kein Sofort-Handlungsbedarf. Beim nächsten geplanten `next`-Upgrade mitziehen. Sollte `next/image` künftig eingeführt werden, wird GHSA-2xp9-vwfh-vxw4 sofort relevant — dann muss das Upgrade vorgezogen werden.

**Verifikation:** live (`npm audit` gegen die aktuelle `package-lock.json`) + Code-Grep (kein `next/image`; Host-OS aus `devops.md`).

---

**Geprüft und unauffällig:**

- **Neues `worker-work:/work`-Volume** (das einzige Config-Delta seit `908c7e2`) — die Arbeitskopien der verwalteten privaten Repos überleben jetzt einen Deploy. Sicherheitsrelevant wäre das, wenn dabei der GitHub-PAT auf Platte landete; tut er nicht: `lib/workspace.ts:192-211` hält die Credentials bewusst aus der Remote-URL heraus (`remoteUrl()` liefert reines https) und schickt sie pro Aufruf als HTTP-Basic-Header, und Zeile 265 schreibt die credential-freie URL sogar in bereits bestehende `.git/config` zurück (bug-003). Kein Fund.
- **Secrets im Repo und in der gesamten Git-Historie** — `git log --all --diff-filter=A` findet als je hinzugefügte env-/Config-Datei nur `.env.example` (Template, alle Werte leer). Die `ghp_…`-/`sk-…`-Treffer liegen ausschließlich in `*.test.ts` als synthetische Fixtures für `lib/redact.ts`. `deploy/*.env` und `watchdog/private/config.php` bleiben in `.gitignore`.
- **Ausfallwächter beim Webhoster** (`watchdog/`) — beide öffentlichen Endpunkte verlangen die Kennung, der Vergleich läuft über `hash_equals` (timing-safe, `watchdog.php:349`), Fehlerantworten verraten nichts über die Ursache, das Geheime liegt außerhalb des Web-Verzeichnisses.
- **Docker-/Compose-Hygiene** — Docker-Socket weiterhin nur im `health-agent`, der keinen Port veröffentlicht und nur vier Operationen annimmt (`agent/routes.ts:15-24`); kein Host-Root-Mount; der `db`-Dienst veröffentlicht keinen Port.
- **Deploy-Workflow** — läuft nur auf `push` für `[dev, main]`, nicht auf `pull_request`; kein Fork-Zugriff auf den self-hosted Runner.
- **Recovery-Endpunkt ohne Rate-Limit** — bewertet und verworfen: Backup-Codes haben 80 Bit Entropie (`randomBytes(10)`, `lib/auth-recovery.ts:13-16`), Brute-Force ist auch ungebremst nicht praktikabel. (`lib/rate-limit.ts` betrifft die Claude-API, nicht Auth.)

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), Cronjob-Einrichtung des Wächters beim Hoster.

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer genau darf zugreifen" und „welche Backup-Erwartung gilt" sind nirgends festgeschrieben — Finding 3 lässt sich ohne dieses SOLL nicht abschließen. Der Skill `setup-security` legt die Datei an.
