---
project: appbaua
template: A
---

# Tech Stack

Diese Datei ist verbindlich für den autonomen Worker. Befolge sie exakt.

## Languages & Frameworks

- Sprache: TypeScript auf Node.
- Framework: Next.js (App Router) — fullstack, ein Deploy-Target.
- UI: React (via Next.js).
- Datenbank: PostgreSQL (via `pg`). Ausgewählt über `DATABASE_URL`; ohne
  gesetzte URL fällt die App auf einen lokalen JSON-Store (`.data/`)
  zurück, damit sie und die Tests ohne DB-Server laufen.
- Deployment: Docker (Dockerfile + docker-compose.yml), auf dem Beelink
  Mini-PC via GitHub Actions (self-hosted Runner). Einrichtung:
  [deploy-setup.md](deploy-setup.md).

## Commands

Der Worker führt diese aus; halte sie copy-paste-fähig und aktuell.
(Abgeglichen mit der package.json seit dem Aufsetzen des Next.js-Projekts.)

- Install: `npm install`
- Build:   `npm run build`
- Test:    `npm test` (Vitest, headless `vitest run`)
- E2E:     `npx playwright test` (noch nicht eingerichtet — folgt mit dem
  ersten UI-Flow, der E2E braucht)
- Lint:    `npm run lint` (ESLint via `next lint`)
- Format:  Prettier noch nicht eingerichtet; Formatierung folgt bei Bedarf
- Types:   `npm run typecheck` (`tsc --noEmit`)

## Testing

Verbindliche Testpolicy für den Worker.

- Jedes Requirement wird mit automatisierten Tests geliefert, die seine
  Akzeptanzkriterien abdecken. Eine Änderung ohne Test für ihr Verhalten
  ist nicht fertig.
- Jeder Bugfix beginnt mit einem fehlschlagenden Test, der den Bug
  reproduziert; dann macht der Fix ihn grün (reproduce-first). Kein
  Repro-Test → nicht gefixt.
- Testebenen: Unit für Logik; Integration für alles, was eine Grenze
  überschreitet (DB, API, externer Service); E2E (Playwright) nur für
  kritische User-Flows, wenige und stabile.
- Die vollständige Test-Suite (siehe Commands) muss vor der Promotion
  nach prod grün sein — das ist die automatisierte Hälfte des Quality
  Gates; die manuelle Abnahme des Nutzers auf der dev-URL ist die andere.

## Conventions

- Formatierung/Linting werden durch die Tools oben erzwungen; vor dem
  Fertigmelden einer Änderung ausführen.
- Ordnerstruktur: Next.js App Router unter `app/`; wiederverwendbare
  Komponenten unter `components/`; serverseitige Logik/DB-Zugriff unter
  `lib/`.
- Naming: React-Komponenten in PascalCase, sonstige Dateien/Ordner in
  kebab-case.
- Datenbankzugriff gebündelt in `lib/` — keine direkten DB-Queries in
  Komponenten.
- HTTPS: Das Frontend wird über HTTPS ausgeliefert (auch dev/Staging).
  Grund: iOS/iPadOS geben Kamera und Mikrofon (getUserMedia) nur in einem
  "secure context" frei; ohne HTTPS sind diese Funktionen später nicht
  nutzbar. Für lokale Entwicklung gilt localhost als sicherer Kontext;
  jede über das Netz erreichbare Umgebung (dev.appbaua.com,
  app.appbaua.com) muss ein gültiges TLS-Zertifikat haben.

## Glossary

Fachbegriffe, die über Requirements, Bugs und Code hinweg einheitlich
verwendet werden. capture-requirement prüft neue Begriffe gegen diese
Liste und ergänzt sie hier. Leer, bis der erste Begriff definiert ist.

| Term | Meaning |
|------|---------|
|      |         |
