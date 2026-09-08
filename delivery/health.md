# Health-Checks

Woran man erkennt, dass diese App funktioniert. Gelesen vom
appbaua-Worker (req-032).

**Format:** Die Abschnitte unten sind ein Maschinen-Vertrag. In ihnen
steht ausschliesslich `- Schlüssel: Wert` — keine Erklärungen, keine
Absätze. Alles, was in einem Abschnitt wie ein Eintrag aussieht, wird als
einer gelesen. Begründungen gehören hierher, vor den ersten Abschnitt,
oder ans Ende.

## Datenbank

- Container: `appbaua-prod-db-1`
- Datenbank: `appbaua_prod`
- Benutzer: `appbaua`

## Web

- dev: `https://dev.appbaua.com` erwartet `307`
- prod: `https://app.appbaua.com` erwartet `307`

## Nicht prüfen

- `appbaua-prod-worker-1`
- `appbaua-dev-worker-1`

## Warum diese Angaben so sind

**Die Web-Prüfung erwartet 307, nicht 200.** Die App ist seit req-023
vollständig geschützt: Ein Aufruf ohne Sitzung wird auf `/login`
weitergeleitet, und genau das ist der gesunde Zustand. Ein `200` an
dieser Stelle hiesse, dass der Zugangsschutz nicht greift.

**Geprüft wird die Startseite, nicht `/api/health`.** Dieser Endpunkt
gehört zur Zustandsübersicht selbst; ihn als Beleg für die eigene
Gesundheit zu nehmen wäre ein Zirkelschluss. Die Startseite durchläuft
Middleware und Sitzungsprüfung und sagt damit genug.

**Nur der prod-Container der Datenbank steht oben.** Der Leser nimmt
genau einen Namen; ein Zusatz wie „(prod)" würde Teil des Namens und
liefe ins Leere. Die dev-Datenbank wird darum hier nicht geprüft.

**Die Worker-Container stehen unter „Nicht prüfen".** Sie laufen in
langen Schritten — bis zu einer Stunde je Paket — und sind zwischendurch
bewusst untätig, wenn nichts in `ready/` liegt. „Läuft" ist bei ihnen
kein Gesundheitszeichen und „beschäftigt" kein Krankheitszeichen; ihr
Zustand steht im Verlauf, nicht in einer Ampel.

**Kein Abschnitt „## KI-Anbieter".** appbaua nutzt keinen API-Schlüssel:
Der Worker meldet sich über das Anthropic-Abo an (`claude login` im
Container). Ein Testaufruf ist damit nicht möglich, und eine abgelaufene
Anmeldung fängt bug-019 an anderer Stelle ab.

**Kein Abschnitt „## Datenfluss".** appbaua empfängt keine Daten von
aussen — es liest Repos und schreibt seinen eigenen Verlauf. Es gibt
nichts, dessen Alter etwas über die Gesundheit aussagen würde.
