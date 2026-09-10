---
type: security
repo: AppBaua
commit: 908c7e2
date: 2026-09-09
---

# Security: AppBaua (908c7e2)

Automatisch erstellt vom appbaua-Worker am 2026-09-09.

---
type: security
repo: appbaua
commit: 908c7e2
date: 2026-09-09
---

# Security: appbaua (908c7e2)

**Kurz-Zusammenfassung:** Es liegt weiterhin **keine repo-spezifische `delivery/security.md`** vor — geprüft wurde daher gegen die aus `delivery/devops.md` und `delivery/stack.md` ableitbaren Vorgaben (öffentliche Erreichbarkeit beider Umgebungen über Cloudflare Tunnel, Passkey-Zugangsschutz, HTTPS-Pflicht) plus allgemeine Best Practices. Der seit dem 2026-08-04 bekannte und seither in jedem Security-Bericht (zuletzt 2026-09-02) gemeldete Kernbefund — **gefälschter Session-Cookie genügt für vollen, auch schreibenden Zugriff** — besteht **unverändert** fort; der zugehörige Code (`middleware.ts`, `lib/auth-request.ts`, alle 33 Routen unter `app/api/`) hat sich seit dem letzten Bericht laut `git diff` **kein Byte** verändert. Heute erneut live gegen `dev.appbaua.com` bestätigt. Daneben: HTTPS wird am Edge weiterhin nicht erzwungen (live bestätigt), es gibt weiterhin keine Backup-Strategie, und `npm audit` weist jetzt zusätzlich zu den bekannten High-Findings eine als **kritisch** eingestufte Next.js-Advisory aus (praktisch nicht ausnutzbar, siehe unten). Keine Secrets im Repo oder in den Commits seit dem letzten Bericht.

---

## 1. Gefälschter Session-Cookie genügt für vollen, auch schreibenden Zugriff — unverändert seit fünf Wochen (hoch)

`middleware.ts:38` prüft weiterhin ausschließlich, ob der Cookie `appbaua_session` gesetzt ist (`Boolean(...)`), nicht ob er einer echten Session entspricht. Der Kommentar dort (Zeilen 4–12) behauptet selbst, das sei „defence in depth“ und die echte Prüfung finde in den API-Routen statt — tatsächlich rufen von 33 Routen unter `app/api/` weiterhin nur drei (`auth/backup-codes`, `auth/invitations`, `auth/me`) `currentUser()` aus `lib/auth-request.ts` auf. Alle übrigen validieren die Session nicht.

**Live heute verifiziert** (`Cookie: appbaua_session=totally-fake-nonexistent-value-xyz`, ein Wert, der nie in einer Datenbank existiert hat):

```
GET https://dev.appbaua.com/api/repos  → 200 {"repos":[{"id":"r17849250898901","name":"appbaua",...}]}
GET https://dev.appbaua.com/api/repos  (ohne Cookie) → 401 {"error":"unauthenticated"}
```

`git diff e9eab56..908c7e2 -- middleware.ts lib/auth-request.ts app/api` ist **leer** — der Code, der diesen Befund erzeugt, wurde seit dem letzten Bericht nicht angefasst. Die im Vorbericht beschriebene schreibende/steuernde Reichweite (Repo-Liste, Verlauf löschen, Container neu starten, Worker-Steuerung schreiben) besteht damit ebenfalls unverändert fort; dazu wurden heute bewusst keine schreibenden Aufrufe gegen die laufende Umgebung ausgeführt.

**Empfehlung:** Unverändert gegenüber dem Vorbericht — ein zentraler `requireUser()`-Wrapper in `lib/auth-request.ts`, der bei fehlender/ungültiger Session 401 liefert, angewandt auf jede nicht-öffentliche Route-Handler-Funktion. Der irreführende Kommentar in `middleware.ts` sollte mit korrigiert werden. Dies ist der mit Abstand wichtigste offene Punkt in diesem Repo.

**Verifikation:** live (lesend, heute gegen `dev.appbaua.com`); Codeabgleich bestätigt Nulldiff seit letztem Bericht.

## 2. HTTPS wird am Edge weiterhin nicht erzwungen, kein HSTS (mittel)

```
GET http://dev.appbaua.com/login  → 200, Location: (kein Redirect)
GET https://dev.appbaua.com/login → 200, Strict-Transport-Security: (nicht gesetzt)
```

Unverändert gegenüber fünf Vorberichten. Das Session-Cookie ist `Secure` und WebAuthn verlangt einen Secure Context, aber jede Anfrage, bei der nicht explizit `https://` eingegeben wird, geht zunächst im Klartext hinaus, bevor ein etwaiger Redirect greift — und aktuell greift keiner.

**Empfehlung:** „Always Use HTTPS“ in Cloudflare für beide Zonen aktivieren und zusätzlich `Strict-Transport-Security` über `headers()` in `next.config.ts` setzen, damit der Schutz nicht allein an einer Dashboard-Einstellung hängt.

**Verifikation:** live (HTTP- und HTTPS-Abruf heute gegen `dev.appbaua.com`).

## 3. Keine Backup-/Wiederherstellungs-Strategie für die Postgres-Daten (niedrig)

Ohne `delivery/security.md` gibt es keine festgelegte Backup-Erwartung, und `delivery/devops.md` nennt keine. Im Repo existiert weiterhin kein Dump-/Snapshot-/Restore-Mechanismus, das `db-data`-Volume in `docker-compose.yml` ist ungesichert, `.github/workflows/` enthält keinen Backup-Schritt. (Abzugrenzen von den Login-Backup-Codes aus req-031 — das ist Kontowiederherstellung, keine Datensicherung.)

**Empfehlung:** Backup-Erwartung per Skill `setup-security` festlegen; ohne dieses SOLL kann dieser Task den Punkt nur weiter wiederholen.

**Verifikation:** aus Code/Config erschlossen.

## 4. `npm audit` meldet jetzt eine kritisch eingestufte Next.js-Advisory zusätzlich zu den bekannten High-Findings (niedrig)

`npm audit --omit=dev`: 1 kritisch, 3 hoch (zuvor nur hoch). Die kritische Advisory für `next` (`^15.5.21`) bündelt zwei CVEs:

- **GHSA-p293-qw3h-jr36** — unauthentifizierte RCE, aber ausdrücklich nur bei **Windows-gehosteten** Servern. Dieses Repo läuft laut `delivery/devops.md` auf einem Ubuntu-Beelink — nicht betroffen.
- **GHSA-2xp9-vwfh-vxw4** — RCE über die Image-Optimization-API bei AVIF-Dateien. `grep -r "next/image"` über `app/`, `components/`, `lib/` liefert **keinen Treffer** — die Komponente wird nicht verwendet, der Pfad ist nicht erreichbar.

Dazu unverändert die transitiven High-Findings in `postcss` (Path Traversal/XSS über `sourceMappingURL`) und `sharp` (geerbte libvips-CVEs) sowie `nanoid` (Endlosschleife bei `size:0`, im Code nirgends so aufgerufen) — alle nur über ein `next`-Major-Upgrade (Breaking Change) behebbar.

**Empfehlung:** Kein Sofort-Handlungsbedarf, da beide Angriffsvoraussetzungen (Windows-Host, `next/image`-Nutzung) hier nicht vorliegen. Beim nächsten geplanten `next`-Upgrade mitziehen; die Advisory-Liste sollte danach beobachtet werden, falls `next/image` künftig eingeführt wird.

**Verifikation:** live (`npm audit` gegen aktuelle `package-lock.json`) + Code-Grep (kein `next/image`, Host-OS aus `devops.md`).

---

**Geprüft und unauffällig:**

- **Secrets im Repo und in den Commits seit dem letzten Bericht** — kein Treffer außerhalb der bekannten Test-Fixtures und Redaction-Muster (`lib/redact.ts`). `deploy/*.env` und `watchdog/private/config.php` bleiben in `.gitignore`, nur `.env.example` ist getrackt.
- **Docker-/Compose-Hygiene** — unverändert: Docker-Socket nur im nicht öffentlich erreichbaren `health-agent`, kein Host-Root-Mount, `/proc` read-only, `init: true` gegen Zombies.
- **Deploy-Workflow** — läuft weiterhin nur auf `push`, nicht auf `pull_request` (kein Fork-Zugriff auf den self-hosted Runner).
- **Commits seit dem letzten Bericht** (`e9eab56..908c7e2`) — ausschließlich `health.md`-Format-/Anleitungsänderungen und Promotions nach prod auf ausdrücklichen Nutzerwunsch; keine sicherheitsrelevante Code-Änderung außer der oben genannten Netzfehler-Unterscheidung in `lib/health-md-source.ts`, die den Kern von Finding 1/2 aus dem Vorbericht nicht berührt.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard (TLS-Modus, Zero-Trust-Regeln), GitHub-Branch-Protection auf `main`, tatsächlicher Zustand des Beelink-Hosts per SSH (kein Zugang hinterlegt), Cronjob-Einrichtung des Ausfallwächters beim Hoster.

**Hinweis zum SOLL:** Ohne `delivery/security.md` prüft dieser Task weiterhin gegen abgeleitete und allgemeine Annahmen — insbesondere „wer darf zugreifen“ und „welche Backup-Erwartung gilt“ sind nirgends festgeschrieben. Der Skill `setup-security` legt sie an.
