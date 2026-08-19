---
type: security
repo: AppBaua
commit: 6a29c1e
date: 2026-08-19
---

# Security: AppBaua (6a29c1e)

Automatisch erstellt vom appbaua-Worker am 2026-08-19.

**Kurz-Zusammenfassung vorab:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die Vorgaben aus `delivery/devops.md`/`delivery/stack.md` sowie allgemeine Best Practices. Seit dem letzten Security-Check (2026-08-12, Commit `f68a98c`) gab es keine einzige Code-/Config-Änderung in `lib/`, `app/`, `middleware.ts`, `docker-compose.yml`, `package.json` oder `.github/` — nur Ideen- und Review-Ablagen. Die drei damaligen Findings bestehen live verifiziert unverändert fort; nichts Neues ist hinzugekommen. Auth-Grundlage bleibt solide (Passkey/WebAuthn, invite-only Registrierung, opake serverseitige Session-Token via `randomBytes(32)`, keine Secrets im Repo oder in der Git-Historie — der einzige `ghp_`-Treffer ist ein synthetisches Test-Fixture in vier `*.test.ts`-Dateien für die Redaction-Logik).

---
type: security
repo: AppBaua
commit: 6a29c1e
date: 2026-08-19
---

# Security: AppBaua (6a29c1e)

**Kurz-Zusammenfassung:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die HTTPS-/Zugriffsvorgaben aus `delivery/devops.md`/`delivery/stack.md` sowie allgemeine Best Practices. Seit dem letzten Bericht (2026-08-12, Commit `f68a98c`) gab es keine Code-/Config-Änderung in einem der vier Prüfbereiche — die drei Findings bestehen unverändert fort, live erneut bestätigt.

## 1. HTTPS wird am Edge weiterhin nicht erzwungen (mittel)

`delivery/stack.md` verlangt: "jede über das Netz erreichbare Umgebung … muss ein gültiges TLS-Zertifikat haben." Live-Test heute (2026-08-19) gegen beide Domains zeigt weiterhin, dass Cloudflare Klartext-HTTP nicht auf HTTPS umleitet, sondern durchreicht:

```
http://dev.appbaua.com  → 307 /login  (unverschlüsselt bedient, kein Redirect auf https)
http://app.appbaua.com  → 307 /login  (unverschlüsselt bedient, kein Redirect auf https)
https://dev.appbaua.com → 307 /login  (Strict-Transport-Security: NONE)
https://app.appbaua.com → 307 /login  (Strict-Transport-Security: NONE)
```

Das Session-Cookie ist `Secure`-geflaggt und WebAuthn scheitert außerhalb eines "secure context" ohnehin — der Login-Weg selbst ist nicht direkt kompromittierbar, aber die explizite Stack-Vorgabe bleibt verletzt, und ohne HSTS bleibt ein Downgrade-Fenster für jeden Nutzer offen, der die URL einmal per `http://` statt `https://` eintippt.

**Empfehlung:** unverändert — in Cloudflare "Always Use HTTPS" für beide Zonen aktivieren und zusätzlich `Strict-Transport-Security` als Response-Header setzen (z. B. via `next.config.ts` `headers()`), damit der Schutz nicht allein von der Cloudflare-Dashboard-Konfiguration abhängt.

**Verifikation:** live (HTTP/HTTPS-Requests heute direkt gegen dev.appbaua.com und app.appbaua.com gestellt).

## 2. Keine dokumentierte Backup-Erwartung für die Postgres-Daten (niedrig)

Weder `delivery/security.md` (nicht vorhanden) noch `delivery/devops.md` benennen eine Backup-/Wiederherstellungs-Strategie für das `db-data`-Volume. Der Ideen-Vorschlag `delivery/idea/backup-mit-restore-drill-nachweis.md` (2026-07-30) liegt weiterhin unverändert offen — kein Dump-/Snapshot-Mechanismus im Repo, kein Restore-Nachweis, keine Backup-Status-Kachel. (Abzugrenzen von der bereits umgesetzten "Backup-Codes neu erzeugen"-Funktion — das sind WebAuthn-Recovery-Codes für Login, keine Datenbank-Backups.)

**Empfehlung:** unverändert — Backup-Erwartung explizit festlegen (Skill `setup-security`) und den vorliegenden Ideen-Vorschlag zur Umsetzung priorisieren, statt ihn weiter als offene Idee liegen zu lassen.

**Verifikation:** aus Code/Config erschlossen (kein Backup-Skript/-Workflow im Repo; Ideen-Datei bestätigt unveränderten Status).

## 3. Bekannte High-Severity-Lücken in von Next.js gebündelten Paketen (niedrig)

`npm audit` meldet unverändert 4 High-Severity-Advisories: `postcss` (≤8.5.22, u. a. Path-Traversal/Info-Disclosure via `sourceMappingURL`, sowie eine XSS-Lücke im CSS-Stringify), `sharp` (<0.35.0, von libvips geerbte CVEs) und `nanoid` (<3.3.18, Endlosschleife bei `size: 0` in Custom-Generatoren) — alle drei transitiv von `next@15.5.21` gebracht. `npm outdated` zeigt `next@15.5.23` als "wanted", `16.3.1` als "latest" (Major-Sprung). `npm audit fix --force` würde `next` auf eine Vorab-/Major-Version heben, was ein eigener bewusster Schritt bleiben sollte, kein Nebeneffekt eines Security-Checks.

Kein praktischer Angriffspfad im Projekt: kein Treffer für `next/image`-Nutzung in `app/`/`components/`, `postcss` verarbeitet zur Laufzeit keine von außen kommende CSS-Eingabe, und der `nanoid`-Bug greift nur bei `customAlphabet(..., 0)`, was im Code nirgends aufgerufen wird.

**Empfehlung:** unverändert — kein sofortiger Handlungsbedarf; bei nächster Next.js-Version mit gepatchtem `postcss`/`sharp`/`nanoid` aktualisieren, vor Einführung von `next/image` erneut prüfen.

**Verifikation:** live (`npm audit` gegen aktuelle `package-lock.json`) + Code-Grep für `next/image` und `customAlphabet`.

---

Nicht prüfbar aus dieser Umgebung: Cloudflare-Dashboard-Konfiguration (Tunnel-/DNS-/TLS-Einstellungen direkt) und GitHub-Branch-Protection auf `main` (kein `gh`-CLI-Zugang im Container).
