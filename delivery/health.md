# Health-Checks

Woran man erkennt, dass diese App funktioniert. Gelesen vom
appbaua-Worker (req-032).

## Datenbank

- Container: `appbaua-prod-db-1` (prod), `appbaua-dev-db-1` (dev)
- Datenbank: `appbaua_prod` bzw. `appbaua_dev`
- Benutzer: `appbaua`

## Web

- dev: `https://dev.appbaua.com` erwartet `307`
- prod: `https://app.appbaua.com` erwartet `307`

**Warum 307 und nicht 200:** Die App ist seit req-023 vollständig
geschützt. Ein Aufruf ohne Sitzung wird auf `/login` weitergeleitet — das
ist der gesunde Zustand. Ein `200` an dieser Stelle hiesse, dass der
Zugangsschutz nicht greift.

**Nicht `/api/health` prüfen.** Dieser Endpunkt gehört zur
Zustandsübersicht selbst; ihn als Beleg für die eigene Gesundheit zu
nehmen wäre ein Zirkelschluss. Die Startseite reicht: Sie durchläuft
Middleware und Sitzungsprüfung und sagt damit genug.

## Nicht prüfen

- **Der Worker-Container.** Er läuft in langen Schritten (bis zu einer
  Stunde je Paket) und ist zwischendurch bewusst untätig, wenn nichts in
  `ready/` liegt. "Läuft" ist bei ihm kein Gesundheitszeichen und
  "beschäftigt" kein Krankheitszeichen — sein Zustand steht im Verlauf,
  nicht in einer Ampel.

- **Ein KI-Anbieter.** appbaua nutzt keinen API-Schlüssel: Der Worker
  meldet sich über das Anthropic-Abo an (`claude login` im Container).
  Ein Testaufruf ist damit nicht möglich, und die abgelaufene Anmeldung
  fängt bug-019 an anderer Stelle ab.

- **Ein Datenfluss.** appbaua empfängt keine Daten von aussen — es liest
  Repos und schreibt seinen eigenen Verlauf. Es gibt nichts, dessen
  Alter etwas über die Gesundheit aussagen würde.
