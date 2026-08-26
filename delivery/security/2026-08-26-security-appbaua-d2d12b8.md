---
type: security
repo: AppBaua
commit: d2d12b8
date: 2026-08-26
---

# Security: AppBaua (d2d12b8)

Automatisch erstellt vom appbaua-Worker am 2026-08-26.

# Security-Bericht: AppBaua (d2d12b8)

**Kurz-Zusammenfassung:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die Vorgaben aus `delivery/devops.md`/`delivery/stack.md` (HTTPS-Pflicht, Zugriffsschutz per Passkey) sowie allgemeine Best Practices. Der seit vier Code-Reviews in Folge (2026-08-04 bis 2026-08-25) offen liegende Befund "Middleware prüft nur Cookie-Vorhandensein, nicht Session-Gültigkeit" habe ich heute **live gegen beide Produktivumgebungen verifiziert und bestätigt**: Ein frei erfundener, nie ausgestellter Session-Cookie-Wert genügt, um auf `app.appbaua.com` (Produktion!) und `dev.appbaua.com` volle Worker-Steuerungsdaten auszulesen. Das ist der schwerwiegendste bisher in diesem Task-Typ dokumentierte Befund — de facto kein Zugriffsschutz trotz WebAuthn/Passkey-Implementierung. Daneben bestehen die bekannten Befunde zu fehlendem HTTPS-Erzwingen, fehlender DB-Backup-Strategie und transitiven `npm audit`-Findings unverändert fort. Keine Secrets im Repo oder in der Git-Historie gefunden (der einzige `ghp_`-Treffer ist weiterhin ein synthetisches Test-Fixture).

---

## 1. Session-Cookie wird nur auf Vorhandensein geprüft, nicht auf Gültigkeit — faktisch kein Zugriffsschutz auf fast allen API-Routen (hoch)

`middleware.ts:38` prüft nur `Boolean(request.cookies.get(SESSION_COOKIE)?.value)` — irgendein nicht-leerer Cookie-Wert reicht. Die im Code-Kommentar (`middleware.ts:6-12`) versprochene zweite Prüfung gegen den Session-Store (`userIdForSession` aus `lib/auth-session.ts`) existiert nur in drei Routen (`app/api/auth/backup-codes`, `.../invitations`, `.../me`). Alle übrigen Routen — u. a. `app/api/repos/*`, `app/api/worker-state/route.ts`, `app/api/task-types/*`, `app/api/system-metrics/route.ts` — validieren gar nichts.

**Live verifiziert soeben (2026-08-26) mit einem frei erfundenen, nie ausgestellten Cookie-Wert (`appbaua_session=totally-fake-nonexistent-value-xyz`):**

```
GET https://app.appbaua.com/api/repos         → 200, liefert echte Repo-Liste (u. a. livinggardentwin, appbaua)
GET https://app.appbaua.com/api/worker-state  → 200, {"state":{"enabled":true}}
GET https://dev.appbaua.com/api/repos         → 200, liefert echte Repo-Liste
GET https://dev.appbaua.com/api/repos (ohne Cookie) → 401 {"error":"unauthenticated"}
```

Ohne Cookie greift der Schutz korrekt (401) — mit **irgendeinem** Wert, auch einem, der in keiner Datenbank je existiert hat, ist die App vollständig offen. Beide Umgebungen hängen laut `devops.md` an je einem öffentlich erreichbaren Cloudflare-Tunnel; die Passkey-Anmeldung (req-023) ist damit für den lesenden und vermutlich auch schreibenden Zugriff auf die Worker-Steuerung wirkungslos, sobald der Angreifer irgendeinen Cookie-Namen/-Wert mitschickt.

**Empfehlung:** Die in `lib/auth-session.ts` bereits vorhandene `userIdForSession`-Prüfung in jede nicht-öffentliche API-Route bzw. einen gemeinsamen Wrapper einbauen (bei ungültiger/abgelaufener Session 401 statt Durchlassen). Höchste Priorität — dies ist kein theoretisches, sondern ein soeben gegen die Produktivumgebung bestätigtes Umgehen des Zugangsschutzes.

**Verifikation:** live, direkt gegen `app.appbaua.com` (Produktion) und `dev.appbaua.com` heute getestet, zusätzlich im Code (`middleware.ts`, fehlende Aufrufe von `userIdForSession` in den betroffenen Routen) bestätigt.

## 2. HTTPS wird am Edge weiterhin nicht erzwungen (mittel)

`delivery/stack.md` verlangt gültiges TLS für jede netzerreichbare Umgebung. Live-Test heute zeigt: Klartext-HTTP wird nicht auf HTTPS umgeleitet, sondern liefert die Login-Seite direkt mit Status 200 (kein Redirect, `Location: NONE`) aus — sowohl auf `dev.appbaua.com` als auch auf `app.appbaua.com`. Zusätzlich fehlt auf beiden Domains der `Strict-Transport-Security`-Header auch über HTTPS vollständig. Das Session-Cookie ist zwar `Secure`-geflaggt und WebAuthn selbst verweigert sich außerhalb eines Secure Context, aber jede sonstige Interaktion (Login-Formular-Aufruf, statische Inhalte) ist per `http://` unverschlüsselt erreichbar, solange der Nutzer nicht selbst `https://` eintippt.

**Empfehlung:** In Cloudflare "Always Use HTTPS" für beide Zonen aktivieren und zusätzlich `Strict-Transport-Security` als Response-Header setzen (z. B. via `next.config.ts` `headers()`), damit der Schutz nicht allein von einer Dashboard-Einstellung abhängt.

**Verifikation:** live (HTTP- und HTTPS-Requests heute direkt gegen beide Domains).

## 3. Keine dokumentierte Backup-Erwartung für die Postgres-Daten (niedrig)

Weder `delivery/security.md` (nicht vorhanden) noch `delivery/devops.md` benennen eine Backup-/Wiederherstellungsstrategie für das `db-data`-Volume. Es existiert kein Dump-/Snapshot-Mechanismus im Repo und kein Restore-Nachweis; der Ideenvorschlag `delivery/idea/backup-mit-restore-drill-nachweis.md` liegt weiterhin unbearbeitet in `delivery/idea/` (nicht in `done/`). Abzugrenzen von den bereits umgesetzten WebAuthn-Backup-Codes (req-031) — das sind Login-Recovery-Codes, keine Datenbank-Backups.

**Empfehlung:** Backup-Erwartung explizit festlegen (Skill `setup-security`) und den vorliegenden Ideenvorschlag zur Umsetzung priorisieren.

**Verifikation:** aus Code/Config erschlossen.

## 4. Bekannte High-Severity-Lücken in von Next.js gebündelten Paketen (niedrig)

`npm audit` meldet unverändert 4 High-Severity-Advisories: `postcss` (Path-Traversal/Info-Disclosure via `sourceMappingURL`, XSS im CSS-Stringify), `sharp` (von libvips geerbte CVEs) — beide transitiv über `next`, sowie `nanoid` (Endlosschleife bei `size: 0` in Custom-Generatoren, im Code nirgends mit `size: 0` aufgerufen). Fix nur über einen Next.js-Major-Sprung (`next@16`) verfügbar. Kein praktischer Angriffspfad erkennbar: kein `next/image`-Einsatz im Code, `postcss` verarbeitet keine von außen kommende Eingabe zur Laufzeit.

**Empfehlung:** Kein sofortiger Handlungsbedarf; bei nächstem geplanten Next.js-Upgrade mitziehen.

**Verifikation:** live (`npm audit` gegen aktuelle `package-lock.json`) + Code-Grep.

---

**Nicht geändert / keine neuen Auffälligkeiten:** Secrets/Zugangsdaten im Repo oder in der Git-Historie (nur ein synthetisches `ghp_`-Test-Fixture in `*.test.ts`-Dateien), Docker/Compose-Hygiene (kein Docker-Socket-, kein Host-Root-Mount, `init: true` gegen Zombie-Prozesse), SQL-Parametrisierung, WebAuthn-Ceremony-Implementierung selbst.

**Nicht prüfbar aus dieser Umgebung:** Cloudflare-Dashboard-Konfiguration (TLS-/Tunnel-Einstellungen direkt), GitHub-Branch-Protection auf `main`.
