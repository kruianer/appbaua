---
type: security
repo: AppBaua
commit: befcdb2
date: 2026-08-05
---

# Security: AppBaua (befcdb2)

Automatisch erstellt vom appbaua-Worker am 2026-08-05.

Alle vier Bereiche geprüft — Auth/Zugriffskontrolle ist sauber, aber die drei Findings aus dem letzten Bericht (2026-07-29) bestehen unverändert fort. Hier der Bericht:

---
type: security
repo: AppBaua
commit: befcdb2
date: 2026-08-05
---

# Security: AppBaua (befcdb2)

**Kurz-Zusammenfassung:** Keine repo-spezifische `delivery/security.md` vorhanden — geprüft gegen die HTTPS-/Zugriffsvorgaben aus `delivery/devops.md`/`delivery/stack.md` sowie allgemeine Best Practices. Seit dem letzten Security-Check (2026-07-29, Commit `543058e`) gab es keine Code-Änderung in einem der vier Prüfbereiche — die einzigen Commits seither betreffen einen Worker-Container-Bugfix (bug-018, Zombie-Prozesse), einen reinen Ideen-Vorschlag und einen abgelegten Code-Review-Bericht. Entsprechend sind alle drei damaligen Findings unverändert offen; keine neuen kommen hinzu. Auth (Passkey/WebAuthn, invite-only Registrierung, Session-Cookies mit `httpOnly`/`secure`/`sameSite=lax`, Token-Redaction in Logs) bleibt solide, keine Secrets im Repo oder in der Git-Historie.

## 1. HTTPS wird am Edge weiterhin nicht erzwungen (mittel)

`delivery/stack.md` verlangt: "jede über das Netz erreichbare Umgebung … muss ein gültiges TLS-Zertifikat haben." Live-Test heute gegen beide Domains zeigt unverändert, dass Cloudflare Klartext-HTTP nicht auf HTTPS umleitet, sondern durchreicht:

```
http://dev.appbaua.com  → 307 /login  (unverschlüsselt bedient)
http://app.appbaua.com  → 307 /login  (unverschlüsselt bedient)
```

Auf der HTTPS-Antwort fehlt zudem weiterhin der `Strict-Transport-Security`-Header (auf beiden Domains geprüft). Das Session-Cookie ist `Secure`-geflaggt und WebAuthn scheitert außerhalb eines "secure context" ohnehin — der Login-Weg selbst ist nicht gefährdet, aber die explizite Vorgabe bleibt verletzt, und ohne HSTS bleibt das Downgrade-Fenster offen.

**Empfehlung:** unverändert — in Cloudflare "Always Use HTTPS" für beide Zonen aktivieren und `Strict-Transport-Security` als Response-Header setzen (z. B. via `next.config.ts` `headers()`).

**Verifikation:** live (HTTP/HTTPS-Requests heute direkt gegen dev.appbaua.com und app.appbaua.com gestellt).

## 2. Keine dokumentierte Backup-Erwartung für die Postgres-Daten (niedrig)

Weder `delivery/security.md` noch `delivery/devops.md` benennen eine Backup-/Wiederherstellungs-Strategie für `db-data`. Es gibt inzwischen einen ausgearbeiteten Vorschlag dazu — `delivery/idea/backup-mit-restore-drill-nachweis.md` (2026-07-30) —, der genau diese Lücke adressiert (periodischer `pg_dump` plus Restore-Drill-Nachweis statt eines unbewiesenen Cronjobs). Das ist bislang nur eine Idee, nicht umgesetzt: kein Dump-/Snapshot-Mechanismus im Repo, kein Restore-Nachweis, keine Backup-Status-Kachel.

**Empfehlung:** unverändert — Backup-Erwartung explizit festlegen (z. B. via Skill `setup-security`) und den vorliegenden Idee-Vorschlag zur Umsetzung priorisieren, statt ihn als offene Idee liegen zu lassen.

**Verifikation:** aus Code/Config erschlossen (kein Backup-Skript/-Workflow im Repo; Ideen-Datei bestätigt den Status als noch nicht umgesetzt).

## 3. Bekannte High-Severity-Lücken in von Next.js gebündelten Paketen (niedrig)

`npm audit` meldet unverändert 3 High-Severity-Advisories für `postcss` (≤8.5.22, u. a. Path-Traversal/Info-Disclosure via `sourceMappingURL`) und `sharp` (<0.35.0, von libvips geerbte CVEs). Beide sind transitiv von `next@15.5.21` gebracht; `npm outdated next` zeigt `15.5.22` als "wanted", `16.2.12`/`16.3.0` als "latest" (Major-Sprung). `npm audit fix --force` würde `next` fälschlich auf `9.3.3` heruntersetzen.

Kein praktischer Angriffspfad im Projekt: kein Treffer für `next/image`-Nutzung in `app/`/`components/` (erneut geprüft), `postcss` verarbeitet zur Laufzeit keine von außen kommende CSS-Eingabe.

**Empfehlung:** unverändert — kein sofortiger Handlungsbedarf, bei nächster Next.js-Version mit gepatchtem `postcss`/`sharp` aktualisieren; vor Einführung von `next/image` erneut prüfen.

**Verifikation:** live (`npm audit` gegen aktuelle `package-lock.json`) + Code-Grep für `next/image`.

---

Nicht prüfbar aus dieser Umgebung: Cloudflare-Dashboard-Konfiguration (Tunnel-/DNS-/TLS-Einstellungen direkt) und GitHub-Branch-Protection auf `main`.
