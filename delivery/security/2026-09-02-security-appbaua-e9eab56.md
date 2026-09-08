---
type: security
repo: AppBaua
commit: e9eab56
date: 2026-09-02
---

# Security: AppBaua (e9eab56)

Automatisch erstellt vom appbaua-Worker am 2026-09-02.

Ich habe genug Material. Hier der Bericht.

---

```markdown
---
type: security
repo: AppBaua
commit: e9eab56
date: 2026-09-02
---

# Security: AppBaua (e9eab56)

Automatisch erstellt vom appbaua-Worker am 2026-09-02.

**Kurz-Zusammenfassung:** Es liegt **keine repo-spezifische `delivery/security.md`** vor
(der Skill `setup-security` wurde nie ausgeführt) — geprüft wurde daher gegen die
Vorgaben, die sich aus `delivery/devops.md` (öffentliche Erreichbarkeit beider Umgebungen
über Cloudflare Tunnel, Passkey-Zugangsschutz) und `delivery/stack.md` (HTTPS-Pflicht für
jede netzerreichbare Umgebung) ergeben, plus allgemeine Best Practices.

Das zentrale Ergebnis: Der seit dem 2026-08-04 in Code-Reviews und seit dem 2026-08-26 im
Security-Task dokumentierte Befund **„Middleware prüft nur, ob ein Session-Cookie da ist,
nicht ob er gültig ist" besteht unverändert fort** — heute erneut live gegen `dev` **und
`prod`** verifiziert. Neu ist, wie weit er inzwischen reicht: die seit req-032/req-035
hinzugekommenen Routen erweitern den unauthentifizierten Zugriff von „lesen" auf
**steuern** — die vollständige private GitHub-Repo-Liste des Betreibers ist abrufbar, der
Verlauf löschbar, überwachte Container auf dem Beelink neu startbar, und über das
Hinzufügen eines eigenen Repos lässt sich steuern, in welchen Containern des Rechners
appbaua `psql` ausführt und welche internen Adressen es abruft. Der Befund ist damit
gegenüber der Vorwoche **gewachsen, nicht geschrumpft**.

Daneben bestehen die bekannten Befunde zu fehlendem HTTPS-Erzwingen, fehlender
DB-Backup-Strategie und transitiven `npm audit`-Findings unverändert. Keine echten Secrets
im Repo oder in der Git-Historie; der Ausfallwächter (req-034) ist sauber gebaut.

---

## 1. Gefälschter Session-Cookie genügt für vollen Zugriff — inzwischen auch schreibend und steuernd (hoch)

`middleware.ts:38` prüft ausschließlich `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`.
Die im Kommentar (`middleware.ts:6–12`) versprochene zweite Prüfung gegen den Session-Store
existiert nur in **drei** von 33 API-Routen (`app/api/auth/backup-codes`,
`app/api/auth/invitations`, `app/api/auth/me` — die einzigen Aufrufer von
`currentUser()` aus `lib/auth-request.ts`). Alle übrigen 30 Routen validieren nichts.

**Live verifiziert heute (2026-09-02) mit `appbaua_session=totally-fake-nonexistent-value-xyz`
— einem Wert, der in keiner Datenbank je existiert hat:**

```
GET https://app.appbaua.com/api/repos        → 200, echte Repo-Liste (LivingGardenTwin, AppBaua, …)
GET https://dev.appbaua.com/api/repos        → 200, echte Repo-Liste
GET https://dev.appbaua.com/api/github-repos → 200, VOLLSTÄNDIGE Liste der privaten
                                                GitHub-Repos des Kontos kruianer
GET https://dev.appbaua.com/api/run-log      → 200, kompletter Verlauf
GET https://dev.appbaua.com/api/worker-state → 200, /api/worker-status → 200,
    /api/system-metrics → 200, /api/health → 200, /api/task-types → 200
GET https://dev.appbaua.com/api/repos (ohne Cookie) → 401 {"error":"unauthenticated"}
GET https://dev.appbaua.com/api/auth/me      → 200 {"user":null}   ← die einzige Route,
                                                die die Session wirklich prüft
```

`/api/auth/me` zeigt den Widerspruch am deutlichsten: dieselbe Anfrage, die dort korrekt
„kein Nutzer" ergibt, liefert eine Zeile weiter die komplette Steuerung aus.

**Was seit dem letzten Bericht dazugekommen ist** (nur aus dem Code erschlossen — ich habe
keinen schreibenden oder steuernden Aufruf gegen eine laufende Umgebung ausgeführt):

- `DELETE /api/run-log` — löscht den gesamten Verlauf, ohne jede Prüfung.
- `POST /api/health/restart` — startet einen überwachten Container auf dem Beelink neu
  (`app/api/health/restart/route.ts`, kein Auth-Check).
- `POST /api/health/analyze` — stößt eine KI-Log-Analyse an; kostet Geld beim
  KI-Anbieter des überwachten Repos und ist beliebig oft auslösbar.
- `POST /api/repos`, `PATCH /api/repos/[id]/*`, `PATCH /api/task-types/[id]/*`,
  `POST /api/worker-state` — die vollständige Worker-Steuerung ist schreibbar: Repos
  hinzufügen, aktivschalten, Modell wechseln, Zeitpläne ändern, Worker an/aus.

Der Passkey-Schutz (req-023) ist damit in der Praxis wirkungslos gegenüber jedem, der die
URL kennt und irgendeinen Cookie mitschickt. Beide Umgebungen hängen laut `devops.md` an je
einem öffentlich erreichbaren Cloudflare-Tunnel.

**Empfehlung:** Einen gemeinsamen Wrapper (z.B. `requireUser()` neben `currentUser()` in
`lib/auth-request.ts`) einführen, der bei ungültiger Session 401 liefert, und ihn in **jede**
nicht-öffentliche Route-Handler-Funktion setzen — nicht routenweise nachrüsten, sondern
einmal zentral, sonst fällt die nächste neue Route wieder durchs Raster. Der Kommentar in
`middleware.ts` sollte anschließend korrigiert werden: er beschreibt heute einen Zustand,
den es nie gab. Höchste Priorität; dieser Befund ist jetzt fünf Wochen alt und wird mit
jedem Requirement größer.

**Verifikation:** Lesende Zugriffe live gegen `dev.appbaua.com` und `app.appbaua.com` heute
bestätigt; schreibende/steuernde Wirkung aus dem Code erschlossen (bewusst nicht ausgeführt).

## 2. Die `health.md` eines überwachten Repos steuert Container-Zugriffe auf dem Host — und wer sie bestimmt, entscheidet Befund 1 (mittel)

`lib/health-md-source.ts` liest `delivery/health.md` des überwachten Repos von GitHub, und
daraus ergibt sich, was die Prüfrunde auf dem Beelink tut:

- **welcher Container** — `spec.database.container` bzw. `matchContainers()` über
  `## Container`-Namen/Präfixe; in ihm wird per `health-agent` `pg_isready` bzw. `psql`
  ausgeführt (`lib/health-checks.ts:149`, `:293`). Der Agent hält den Docker-Socket und
  läuft als root; der Container-Name wird nicht gegen die Container **dieser** App geprüft.
- **welche Datenbank/welcher Benutzer** — frei aus der Datei (`lib/health.ts:260–262`).
- **welche Adressen abgerufen werden** — jede URL aus `## Web` und aus „Woran erkennbar"
  wird vom App-Container geholt (`lib/health-checks.ts:252`). Das ist ein Abruf aus dem
  Heimnetz heraus auf eine vom Angreifer gewählte Adresse (SSRF), inklusive
  RFC1918-Adressen; zurück kommt der Status bzw. ein Zeitstempel aus der Antwort.
- **welche Umgebungsvariable gelesen wird** — `## KI-Anbieter → Schlüssel aus:`
  (`lib/health-checks.ts:385`). Der Wert wird nicht ausgegeben und nur als Header an
  OpenAI/Anthropic geschickt, deshalb kein direkter Abfluss — aber der Name ist frei
  wählbar.

**Ausdrücklich nicht gefunden:** eine SQL-Injection. `SELECT MAX(${target.column}) FROM
${target.table}` (`lib/health-checks.ts:300`) sieht danach aus, aber `parseTableColumn`
lässt nur `[a-z0-9_.]` durch (`:219–223`), und `psql` wird mit getrenntem argv statt über
eine Shell aufgerufen — kein Semikolon, kein Leerzeichen, kein Ausbruch. Auch die
Befehlsliste ist eng (`ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"]`, doppelt geprüft in
`agent/index.ts:78` und `lib/docker.ts:200`). Der Health-Agent ist an dieser Stelle sauber
gebaut.

Was bleibt: `SELECT MAX(spalte) FROM tabelle` gegen eine **beliebige** Postgres-Datenbank in
einem **beliebigen** Container des Rechners, mit einem beliebigen `-U`-Benutzer — im
offiziellen Postgres-Image über den lokalen Socket typischerweise als Superuser. Das ist
ein schmaler, aber echter Auslesekanal in die Datenbanken der anderen Apps auf dem Beelink.

Auslösbar ist das alles über `POST /api/repos` (eigenes öffentliches GitHub-Repo eintragen,
die Erreichbarkeitsprüfung besteht es) + `PATCH /api/repos/[id]/monitored` +
`GET /api/health` (stößt `runDueChecks()` an) — drei Aufrufe, die nach Befund 1 **keine
Anmeldung brauchen**.

**Empfehlung:** Zuerst Befund 1 schließen — danach ist das nur noch eine Frage des
Vertrauens in die eigenen Repos. Unabhängig davon: Container aus der `health.md` gegen die
tatsächlich zu diesem Repo gehörenden Container prüfen, bevor `exec` sie erreicht, und die
URLs der Web-/Datenfluss-Prüfung auf `http(s)` mit öffentlich auflösbaren Zielen begrenzen.

**Verifikation:** aus Code/Config erschlossen (keine Ausführung gegen eine laufende
Umgebung); der unauthentifizierte Einstieg in die Kette ist über Befund 1 live bestätigt.

## 3. HTTPS wird am Edge weiterhin nicht erzwungen, kein HSTS (mittel)

`delivery/stack.md` verlangt ein gültiges TLS-Zertifikat für jede über das Netz erreichbare
Umgebung. Live-Test heute:

```
GET http://dev.appbaua.com/login  → 200, Location: NONE   (kein Redirect auf https)
GET https://dev.appbaua.com/login → 200, Strict-Transport-Security: NONE
```

Dasselbe Bild auf beiden Domains. Das Session-Cookie ist `Secure`-geflaggt und WebAuthn
verweigert sich außerhalb eines Secure Context, aber jeder Aufruf, bei dem der Nutzer nicht
selbst `https://` tippt, geht im Klartext hinaus. Unverändert gegenüber vier Vorberichten.

**Empfehlung:** In Cloudflare „Always Use HTTPS" für beide Zonen aktivieren **und**
`Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz
nicht allein an einer Dashboard-Einstellung hängt.

**Verifikation:** live (HTTP- und HTTPS-Abrufe heute gegen beide Domains).

## 4. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Es gibt keine `delivery/security.md` mit einer Backup-Erwartung, und `delivery/devops.md`
nennt keine. Im Repo existiert kein Dump-, Snapshot- oder Restore-Mechanismus; das
`db-data`-Volume in `docker-compose.yml` hat keine Sicherung. `.github/workflows/deploy.yml`
enthält keinen Backup-Schritt. Der Vorschlag
`delivery/idea/backup-mit-restore-drill-nachweis.md` liegt weiterhin unbearbeitet in
`delivery/idea/` — `delivery/idea/done/` ist leer.

Abzugrenzen von den Backup-Codes aus req-031: das sind Login-Wiederherstellungscodes,
keine Datensicherung.

**Empfehlung:** Backup-Erwartung über den Skill `setup-security` festlegen und den
vorliegenden Ideenvorschlag zur Umsetzung ziehen. Ohne festgelegtes SOLL kann dieser Task
den Punkt jede Woche nur erneut anmerken.

**Verifikation:** aus Code/Config erschlossen.

## 5. Vier bekannte High-Severity-Advisories in von Next.js gebündelten Paketen (niedrig)

`npm audit --omit=dev` meldet unverändert: `postcss` (Path Traversal / Arbitrary `.map`
File Disclosure über `sourceMappingURL`, XSS im CSS-Stringify), `sharp` (geerbte
libvips-CVEs CVE-2026-33327/33328/35590/35591) — beide transitiv über `next` — sowie
`nanoid` (Endlosschleife bei `size: 0`, im Code nirgends so aufgerufen). Behebung nur über
`next@16` (Breaking Change). Kein praktischer Angriffspfad erkennbar: `next/image` wird
nicht verwendet, `postcss` verarbeitet zur Laufzeit keine Eingaben von außen.

**Empfehlung:** Kein Sofort-Handlungsbedarf; beim nächsten geplanten Next.js-Upgrade
mitziehen. Zu beachten: die Advisory-Liste wächst — beim letzten Bericht waren es zwei
`postcss`-Einträge, heute vier.

**Verifikation:** live (`npm audit` gegen die aktuelle `package-lock.json`) + Code-Grep.

---

**Geprüft und unauffällig:**

- **Secrets im Repo und in der Historie** — kein echter Treffer. Alle Fundstellen sind
  synthetische Test-Fixtures (`ghp_A1b2C3…` in `redact.test.ts`, `workspace.test.ts`,
  `worker-loop.test.ts`, `appbaua-standard.test.ts`; `sk-…`/`hunter2` in
  `log-analysis*.test.ts` — genau die Fälle, die die Redaction prüfen). Getrackt ist nur
  `.env.example`; `deploy/*.env` und `watchdog/private/config.php` sind in `.gitignore`.
- **Credential-Redaction** (`lib/redact.ts`) — deckt GITHUB_TOKEN, GH_TOKEN und seit
  req-033 auch TELEGRAM_BOT_TOKEN ab, dazu URL-Userinfo, PAT-Muster und
  Authorization-Header, und wird auf dem Weg in Verlauf und Log-Bundle angewandt.
- **Ausfallwächter** (req-034, `watchdog/`) — `hash_equals` gegen Timing, Geheimnisse
  außerhalb des Web-Verzeichnisses, atomares Schreiben des Zustands über
  `rename`, keine Auskunft im Fehlerfall. Sauber.
- **Docker-/Compose-Hygiene** — der Docker-Socket liegt bewusst nur im `health-agent`, der
  keinen Port veröffentlicht; die internetzugewandte App hat ihn nicht (Lehre aus bug-005).
  Kein Host-Root-Mount, `init: true` gegen Zombies, `/proc` read-only.
- **WebAuthn-Ceremony selbst** — opake Session-Token aus `randomBytes(32)`, `httpOnly` /
  `secure` / `sameSite=lax`, SHA-256-gehashte Backup-Codes, invite-only Registrierung.
  Beide Umgebungen melden `bootstrapped: true` — die Ersteinrichtung ist also nicht mehr
  offen übernehmbar.
- **Deploy-Workflow** — läuft nur auf `push` (nicht auf `pull_request`), damit erreicht
  kein Fork den self-hosted Runner; env-Dateien liegen außerhalb des Repos.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, Tunnel-Einstellungen,
Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, tatsächlicher Zustand des
Beelink-Hosts per SSH (kein Zugang hinterlegt), Cronjob-Einrichtung des Wächters beim Hoster.

**Hinweis zum SOLL:** Solange keine `delivery/security.md` existiert, prüft dieser Task
gegen abgeleitete und allgemeine Annahmen. Insbesondere „wer darf zugreifen" und
„welche Backup-Erwartung gilt" sind derzeit nirgends festgeschrieben — Befund 4 lässt sich
ohne diese Datei nicht abschließend bewerten. Der Skill `setup-security` legt sie an.
```
