---
name: setup-auth
description: Bringt THIS project auf den gemeinsamen Anmelde-Standard aller Apps des Betreibers — beim Oeffnen der App sofort die Geraete-Entsperrung (Face ID / Touch ID / Windows Hello) ohne Button, Mandantentrennung von Anfang an, Einladung statt offener Selbstregistrierung, E-Mail-Link als Wiederherstellung wenn das Geraet weg ist, und zeitlich begrenzte Gastzugaenge per Link oder QR-Code ohne Passkey. Klaert in wenigen Fragen, was dieses Repo davon braucht, und schreibt daraus ein fertiges Requirement nach delivery/requirements/ready/, das der Worker umsetzt. Nutze diesen Skill, wenn der Nutzer fuer dieses Repo eine Anmeldung, einen Zugangsschutz, Gastzugaenge oder eine Benutzerverwaltung will (z.B. "die App braucht einen Login", "Zugangsschutz einbauen", "Anmeldung wie bei den anderen Apps", "Face ID", "Gast einladen") — auch dann, wenn er nur "Login" sagt, ohne den Standard zu erwaehnen.
---

# Anmeldung nach dem gemeinsamen Standard einrichten

Du richtest fuer THIS project die Anmeldung ein — nicht, indem du sie
selbst baust, sondern indem du daraus ein Requirement machst, das der
Worker dieses Repos umsetzt.

Der Punkt dieses Skills ist Gleichheit: Alle Apps des Betreibers sollen
sich gleich anmelden. Ein Nutzer, der eine App kennt, kennt alle. Und ein
Fehler, der einmal gefunden wird, laesst sich ueberall gleich beheben.
Deshalb ist der Standard unten NICHT verhandelbar — verhandelbar ist nur,
was dieses Repo davon braucht.

Sprache: Fuehre den Dialog UND schreibe das Requirement in der Sprache,
in der der Nutzer mit dir spricht. Ausnahme (Maschinen-Vertrag): Der
Dateiname `req-NNN-<slug>.md`, die Ordnerpfade und die
Abschnitts-Ueberschriften des Requirements (`# Goal (Why)`,
`# Function (What)`, `# Acceptance Criteria`, `# Constraints`,
`# Out of Scope`) bleiben unveraendert, egal in welcher Sprache.

## Der Standard

Das Folgende gilt in jeder App. Weiche nur davon ab, wenn der Nutzer es
ausdruecklich verlangt — und schreib die Abweichung dann sichtbar ins
Requirement, damit sie nicht als Versehen durchgeht.

### Anmelden

**Die Entsperrung kommt sofort, ohne Button.** Oeffnet ein bekannter
Nutzer die App, erscheint unmittelbar die Geraete-Abfrage: Face ID auf
dem iPhone/iPad, Touch ID oder Windows Hello auf dem Laptop. Kein
"Mit Passkey anmelden"-Knopf davor.

Technisch heisst das **Conditional UI** (`mediation: "conditional"`) mit
einem Anmeldefeld, das `autocomplete="username webauthn"` traegt: Der
Browser bietet den passenden Passkey von sich aus an. Ein sichtbarer
Knopf bleibt als Rueckfallweg fuer den Fall, dass der Browser Conditional
UI nicht kann — er ist die Ausnahme, nicht der Normalweg.

**Face ID ist Pflicht, nicht Kuer.** `userVerification: "required"` —
sonst gibt ein Geraet den Passkey unter Umstaenden ohne biometrische
Pruefung frei, und der Schutz waere nur die Geraetenaehe.

**Der Passkey muss auf dem Geraet auffindbar sein.**
`residentKey: "required"` (Discoverable Credential). Ohne das kann der
Browser vor der Anmeldung nicht wissen, welcher Passkey passt — und genau
das ist die Voraussetzung dafuer, dass die Abfrage von selbst kommt.

**Ein Passkey pro Geraet, nicht pro Person.** iPhone, iPad und Windows-PC
bekommen jeweils einen eigenen. Apple-Geraete synchronisieren ihre
Passkeys ueber den iCloud-Schluesselbund, Windows Hello tut das nicht —
der PC braucht also seinen eigenen. Ein angemeldeter Nutzer muss deshalb
jederzeit einen weiteren Passkey hinzufuegen koennen, und seine Geraete
in einer Liste sehen (Name, letzte Verwendung, einzeln entfernbar).

### Abmelden und Sitzungen beenden

**Die Sitzung gilt 7 Tage und verlaengert sich bei Nutzung.** Wer die App
regelmaessig benutzt, meldet sich nie wieder an; nach einer Woche Pause
kommt einmal Face ID. Die Dauer ist bewusst kurz gehalten: Weil die
Anmeldung eine Sekunde dauert, kauft eine laengere Sitzung kaum
Bequemlichkeit — sie verlaengert nur das Fenster, in dem ein verlorenes
Geraet offen bleibt.

**Abmelden gibt es immer.** Ein Klick, und die App ist gesperrt. Das
beendet die Sitzung dieses Geraets, nicht den Passkey — beim naechsten
Mal kommt wieder Face ID und man ist drin.

**Ein entfernter Passkey beendet auch seine Sitzungen.** Wer unter
"Meine Geraete" das verlorene iPad entfernt, erwartet, dass es damit
draussen ist. Wuerde nur der Passkey geloescht, koennte der Finder die
laufende Sitzung bis zu ihrem Ablauf weiterbenutzen — der gefaehrlichste
Moment waere genau der, in dem der Nutzer glaubt, gehandelt zu haben.

**"Ueberall abmelden" gehoert dazu.** Ein Knopf, der alle Sitzungen des
Nutzers auf allen Geraeten beendet, auch die gerade benutzte. Der Weg fuer
den Fall, dass jemand nicht mehr weiss, wo er ueberall angemeldet ist.
Die Passkeys bleiben dabei bestehen — es ist ein Abmelden, kein
Aussperren.

### Wenn das Geraet weg ist

**E-Mail-Link ist der Wiederherstellungsweg.** Nicht Notfallcodes: Codes,
die man einmal ausdruckt und jahrelang nicht braucht, sind zum Zeitpunkt
des Verlusts erfahrungsgemaess nicht auffindbar. Der Nutzer gibt seine
E-Mail-Adresse an, bekommt einen einmaligen Link, und registriert damit
einen neuen Passkey.

Der Link ist eng gefasst, weil er der schwaechste Punkt des ganzen
Systems ist:

- gueltig 15 Minuten, danach wertlos;
- genau einmal verwendbar;
- nur als Hash gespeichert, nie im Klartext;
- er meldet NICHT an, er berechtigt ausschliesslich dazu, einen neuen
  Passkey zu registrieren;
- er wird immer an die hinterlegte Adresse geschickt, nie an eine im
  Formular eingegebene;
- die Antwort der App ist immer dieselbe ("Falls die Adresse bekannt ist,
  wurde ein Link verschickt"), damit sich ueber das Formular nicht
  herausfinden laesst, wer ein Konto hat;
- hoechstens 3 Anforderungen pro Stunde und Konto.

Backup-Codes bleiben moeglich, aber nur als bewusst gewaehlter Zusatz —
nie als einziger Weg.

### Mailversand

Der Wiederherstellungs-Link ist nur so verlaesslich wie der Mailversand
dahinter. Der Standard nutzt in allen Apps denselben: **SMTP bei
all-inkl.com**.

Konfiguriert wird er ueber Umgebungsvariablen, nie ueber Werte im Repo:

| Variable | Wert |
|---|---|
| `SMTP_HOST` | **immer `w0089340.kasserver.com`** — bei all-inkl fuer alle Apps derselbe |
| `SMTP_PORT` | `587` (STARTTLS) — bevorzugt, oder `465` (implizites TLS) |
| `SMTP_USER` | Postfach-Benutzername (liefert der Betreiber) |
| `SMTP_PASSWORD` | Postfach-Kennwort (liefert der Betreiber) |
| `MAIL_FROM` | Absenderadresse nach der Konvention unten |

**Absenderadresse.** Jede App verschickt unter ihrer eigenen Domain, nach
demselben Muster:

```
noreply@<app-domain>
```

Also `noreply@appbaua.com`, `noreply@wegfara.com` und so fort. Die Domain
steht im `## Environments`-Abschnitt der `delivery/devops.md` des Repos —
nimm die Domain der prod-URL, ohne Host-Praefix: aus
`https://app.wegfara.com` wird `wegfara.com`, also
`noreply@wegfara.com`.

Beide Umgebungen verschicken unter derselben Adresse; unterschieden wird
im Betreff (siehe unten), nicht im Absender. Als Anzeigename gehoert der
App-Name davor, damit im Postfach erkennbar ist, woher die Mail kommt:
`Wegfara <noreply@wegfara.com>`.

Die Werte fuer `SMTP_USER` und `SMTP_PASSWORD` liegen wie alle
Geheimnisse dieser Umgebungen in den env-Dateien auf dem Server
(`~/<app>-env/dev.env` bzw. `prod.env`), NICHT im Repo und nicht in der
Compose-Datei. Im Requirement stehen nur die Variablennamen.

Regeln fuer den Versand:

- **TLS ist Pflicht.** Port 587 mit STARTTLS, oder 465. Ein unverschluesselter
  Versand ist keine Option — im Link steckt ein Zugang zum Konto.
- **Ein fehlgeschlagener Versand darf die Antwort der App nicht
  veraendern.** Sonst laesst sich am Verhalten ablesen, ob eine Adresse
  bekannt ist. Der Fehler gehoert ins Log, nicht in die Antwort.
- **Der Link traegt die Origin der Umgebung, aus der er stammt.** Ein auf
  dev angeforderter Link zeigt auf dev, nicht auf prod.
- **Nichts Vertrauliches in der Mail** ausser dem Link selbst: keine
  Kontodaten, keine Liste der Geraete.
- Fuer dev genuegt dasselbe Postfach; der Betreff soll die Umgebung
  nennen, damit eine dev-Mail nicht mit einer echten verwechselt wird.

### Mandanten

**Jede App ist von Anfang an mandantenfaehig.** Jeder Datensatz gehoert
zu genau einem Mandanten, und jede Abfrage filtert danach. Das gilt auch
dann, wenn es vorerst nur einen Mandanten gibt: Mandantentrennung
nachtraeglich einzuziehen bedeutet, jede Tabelle und jede Abfrage
anzufassen — und eine vergessene Stelle zeigt fremde Daten.

Fuer den Start:

- Der Bootstrap legt einen ersten Mandanten an und macht den Betreiber zu
  dessen Besitzer. Der Betreiber ist in allen Apps derselbe:
  **uwe@kremmel.org**. Diese Adresse ist beim Bootstrap gesetzt, nicht
  eingetippt — dadurch steht der Wiederherstellungsweg ab der ersten
  Minute, und nicht erst, wenn jemand daran denkt, eine Adresse zu
  hinterlegen. Sie gehoert als Vorgabewert ins Requirement (ueberschreibbar
  per Umgebungsvariable, z.B. `BOOTSTRAP_EMAIL`, aber ohne Zutun genau
  diese).
- Die Mandantenauswahl bleibt in der Oberflaeche unsichtbar, solange ein
  Nutzer nur zu einem Mandanten gehoert. Sie erscheint von selbst, sobald
  es mehr werden.
- Der Mandant kommt IMMER aus der Sitzung, nie aus einem Parameter der
  Anfrage. Ein Nutzer darf einen fremden Mandanten nicht dadurch
  erreichen, dass er eine ID in der URL aendert.

### Wer hineinkommt

**Keine offene Selbstregistrierung.** Weitere Personen kommen nur ueber
eine Einladung des Betreibers hinein.

**Jedes Konto hat eine E-Mail-Adresse — von Anfang an.** Die Einladung
geht an eine Adresse, und diese Adresse bleibt am Konto haengen. Ohne sie
gaebe es fuer den Eingeladenen spaeter keinen Weg zurueck, wenn sein
Geraet verloren geht. Ein Konto ohne hinterlegte Adresse darf gar nicht
erst entstehen.

Drei Arten von Zugang:

| | Anmeldung | Dauer | Sieht |
|---|---|---|---|
| Betreiber | Passkey | dauerhaft | alles, verwaltet Nutzer und Gaeste |
| Mitglied | Passkey | dauerhaft | alles ausser Verwaltung |
| Gast | Link/QR, kein Passkey | begrenzt | nur was ausdruecklich freigegeben ist |

**Gastzugang ohne Passkey.** Ein Gast bekommt einen Link (auch als
QR-Code darstellbar) und ist damit drin — ohne Konto, ohne
Geraete-Einrichtung. Das ist bewusst schwaecher als ein Passkey, deshalb
ist es eng begrenzt:

- Der Betreiber legt beim Erstellen fest, wie lange der Zugang gilt
  (Vorgabe 7 Tage, hoechstens 90, nie unbegrenzt) und worauf er Zugriff
  gibt;
- **nur lesend**, sofern der Betreiber nicht ausdruecklich etwas anderes
  freigibt;
- der Link traegt ein Geheimnis mit mindestens 128 Bit Zufall, das nur
  als Hash gespeichert wird;
- er ist jederzeit widerrufbar, und ein Widerruf wirkt sofort — auch fuer
  eine bereits laufende Gast-Sitzung;
- die Gast-Sitzung ist an den Link gebunden und laeuft mit ihm ab, statt
  eigenstaendig weiterzuleben;
- der Betreiber sieht, welche Gastzugaenge es gibt, wann sie zuletzt
  benutzt wurden und wann sie ablaufen.

Ein Gast kann jederzeit auf ein vollwertiges Konto hochgestuft werden,
indem der Betreiber ihn einlaedt — dann bekommt er einen Passkey.

### Die Oberflaeche dazu

Alles oben braucht Bedienung, sonst existiert es nur als API. Jede App
bekommt dieselben vier Bereiche — gleiche Reihenfolge, gleiche Benennung,
im Stil der jeweiligen App:

**1. Anmeldeseite.** Ein Feld mit `autocomplete="username webauthn"`, das
die Geraete-Abfrage von selbst ausloest. Darunter, kleiner: ein
Anmeldeknopf als Rueckfallweg, "Anderes Geraet verwenden" und "Zugang
verloren".

**2. Meine Geraete** (jeder angemeldete Nutzer). Liste der eigenen
Passkeys mit Name, Hinzugefuegt-am und Zuletzt-verwendet. Je Eintrag
"Entfernen", darueber "Dieses Geraet hinzufuegen". Der letzte Passkey
laesst sich nur entfernen, wenn eine hinterlegte E-Mail-Adresse
existiert — sonst sperrt sich der Nutzer selbst aus. Unten "Ueberall
abmelden", mit dem Hinweis, dass danach auch dieses Geraet abgemeldet
ist. "Abmelden" selbst gehoert an die gewohnte Stelle der App (Menue
oder Kopfzeile), nicht hierher.

**3. Nutzer** (nur Betreiber). Liste der Nutzer des Mandanten mit Name,
E-Mail, Rolle, Beitritt und letzter Anmeldung. Aktionen: "Einladen"
(E-Mail-Adresse eingeben, Link geht raus), offene Einladungen mit
Ablaufdatum und "Zurueckziehen", sowie Nutzer entfernen. Der letzte
Betreiber eines Mandanten kann nicht entfernt oder herabgestuft werden.

**4. Gastzugaenge** (nur Betreiber). Liste der ausgestellten Zugaenge mit
Zweck, Ablauf, letzter Verwendung und Status. "Gastzugang erstellen"
fragt nach Zweck, Dauer (Vorgabe 7 Tage) und Umfang; danach erscheint der
Link **als Text UND als QR-Code**, mit dem Hinweis, dass er nur jetzt
sichtbar ist. Je Eintrag "Widerrufen", was sofort wirkt.

Zwei Regeln, die fuer alle vier gelten:

- **Was nicht erlaubt ist, wird nicht angezeigt.** Ein Mitglied sieht
  "Nutzer" und "Gastzugaenge" gar nicht erst. Das ersetzt nicht die
  Pruefung auf dem Server — die gilt zusaetzlich und immer.
- **Geheimnisse werden genau einmal gezeigt.** Gastlinks und Einladungen
  erscheinen unmittelbar nach dem Erstellen; danach nie wieder, weil nur
  ihr Hash gespeichert ist. Das steht als Hinweis daneben.

Ein Gast sieht keinen dieser Bereiche — nur den freigegebenen Ausschnitt
der App.

### Technische Grundlagen

**Sitzung im httpOnly-Cookie.** Nicht im localStorage — ein Skript darf
nicht an die Sitzung kommen. `sameSite: lax`, und `secure`, sobald die
Umgebung ueber das Netz erreichbar ist.

**Feste Zeiten.** Diese Werte sind in jeder App gleich. Nicht schaetzen,
nicht anpassen, nicht nachfragen:

| Was | Wert |
|---|---|
| Sitzung (Passkey-Nutzer) | 7 Tage, verlaengert sich bei Nutzung |
| Sitzung (Gast) | endet mit dem Gastzugang, nie spaeter |
| Gastzugang, Vorgabe | 7 Tage |
| Gastzugang, Hoechstwert | 90 Tage |
| Wiederherstellungs-Link | 15 Minuten |
| Einladung | 7 Tage |
| WebAuthn-Challenge | 5 Minuten |
| Wiederherstellung, Anforderungen | hoechstens 3 pro Stunde und Konto |

Der Betreiber kann die Dauer eines Gastzugangs beim Erstellen waehlen —
zwischen einer Stunde und dem Hoechstwert. Voreingestellt sind 7 Tage.

**Passkeys sind je Umgebung getrennt.** Ein auf dev registrierter Passkey
gilt auf prod NICHT und umgekehrt. Das ergibt sich aus rpId/Origin und
ist beabsichtigt: dev-Zugang ist kein prod-Zugang.

**Alles ist geschuetzt, ausser dem Anmeldeweg selbst.** Nicht einzelne
Seiten werden abgesichert, sondern die ganze App; offen sind nur
Anmeldung, Wiederherstellung, Gast-Einloesung und deren API-Routen. Eine
neue Seite ist damit automatisch geschuetzt und nicht versehentlich offen.

**HTTPS ist Voraussetzung.** WebAuthn funktioniert nur im "secure
context". Fuer lokale Entwicklung gilt `localhost` als sicher, jede ueber
das Netz erreichbare Umgebung braucht ein gueltiges Zertifikat.

## Die zwei Ablaeufe, die immer gleich sind

Diese beiden Wege sehen in jeder App identisch aus. Sie gehoeren als
Ablauf ins Requirement, nicht nur als Feature-Liste.

### Eine neue App zum ersten Mal betreten

1. Die App ist deployt, `SMTP_USER` und `SMTP_PASSWORD` stehen in der
   env-Datei der Umgebung. Es gibt noch keinen Nutzer.
2. Der Betreiber ruft die App auf. Weil noch niemand existiert, zeigt die
   Anmeldeseite **einen** zusaetzlichen Weg: "Ersteinrichtung starten".
   Dieser Weg ist ausschliesslich sichtbar, solange die Nutzertabelle
   leer ist — mit dem ersten Nutzer verschwindet er dauerhaft.
3. Er folgt ihm und registriert seinen ersten Passkey. Dabei entstehen in
   einem Zug: der erste Mandant, der Betreiber-Nutzer mit
   `uwe@kremmel.org` als hinterlegter Adresse, und dessen erster Passkey.
4. Er ist angemeldet.
5. Auf jedem weiteren Geraet (iPad, Windows-PC) oeffnet er die App, waehlt
   "Zugang verloren", laesst sich einen Link schicken und registriert
   damit den Passkey dieses Geraets. Ab dann kommt dort die
   Geraete-Entsperrung von selbst.

Kein Kommandozeilen-Befehl, kein Datenbank-Eingriff, kein Startwert in
einer Konfigurationsdatei. Der Bootstrap laeuft ueber die Oberflaeche —
sonst braeuchte jede App eine eigene Anleitung, und genau das soll dieser
Standard verhindern.

Die Sicherheit liegt darin, dass der Weg nur bei leerer Nutzertabelle
existiert: Wer ihn sieht, ist der Erste. Das Zeitfenster zwischen Deploy
und Ersteinrichtung ist der einzige verwundbare Moment — deshalb gehoert
die Ersteinrichtung unmittelbar nach dem Deploy gemacht.

### Geraet verloren

1. Der Betreiber oeffnet die App auf einem beliebigen anderen Geraet und
   waehlt "Zugang verloren".
2. Er gibt seine E-Mail-Adresse ein. Die App antwortet immer gleich:
   "Falls die Adresse bekannt ist, wurde ein Link verschickt."
3. Aus der Mail heraus registriert er den Passkey des neuen Geraets. Der
   Link ist danach verbraucht.
4. Unter "Meine Geraete" entfernt er den Passkey des verlorenen Geraets.

Hat er noch ein funktionierendes Geraet, geht es kuerzer: dort anmelden,
"Meine Geraete", neues Geraet hinzufuegen, altes entfernen — ohne E-Mail.

**Ist die E-Mail-Adresse selbst nicht mehr erreichbar,** gibt es keinen
Weg zurueck. Das ist beabsichtigt: Eine Hintertuer, die dem Betreiber
hilft, hilft auch jedem anderen. In diesem Fall bleibt nur der Zugriff
auf die Datenbank des Servers — der Betreiber loescht dort die Nutzer,
womit die Ersteinrichtung wieder erscheint. Dieser Notweg gehoert in die
`delivery/devops.md` des Repos, nicht in die App.

## Geraete ohne Passkey

Nicht jedes Geraet kann Passkeys — ein alter Android-Browser, ein
Firmen-Laptop mit gesperrtem TPM, ein Kiosk-Rechner. Der Standard sieht
dafuer drei Wege vor, in dieser Reihenfolge:

1. **Passkey von einem anderen Geraet (der Normalfall).** Beim Anmelden
   "Anderes Geraet verwenden" waehlen: Es erscheint ein QR-Code, der
   Nutzer scannt ihn mit dem Handy, entsperrt dort per Face ID — und der
   Laptop ist angemeldet. Das kann jeder aktuelle Browser, es braucht auf
   dem Laptop selbst keinerlei Passkey-Faehigkeit. Deshalb ist das die
   erste Antwort, nicht die Ausnahme.
2. **E-Mail-Link.** Derselbe Weg wie bei Geraeteverlust, mit denselben
   Grenzen (15 Minuten, einmalig).
3. **Gastzugang.** Wenn jemand nur kurz etwas ansehen soll, ist ein
   befristeter Gastlink die passendere Antwort als ein Konto.

Ein Passwort-Login ist KEINE Antwort darauf. Wer meint, einen zu
brauchen, hat einen der drei Wege oben noch nicht geprueft.

## Flow

### 1. Repo verstehen (bevor du fragst)

Lies, was das Repo schon hat — frag den Nutzer nicht nach Dingen, die
dort stehen:

- `delivery/stack.md`: Sprache, Framework, Testbefehl. Danach richtet
  sich, WIE die Anmeldung gebaut wird (Next.js Middleware vs. FastAPI
  Dependency vs. etwas anderes).
- `delivery/devops.md`, Abschnitt `## Environments`: Welche Umgebungen
  gibt es und unter welchen URLs? Daraus ergeben sich rpId und Origin.
- Gibt es schon eine Anmeldung? Suche nach `auth`, `login`, `session`,
  `passkey`, `tenant`, `mandant`. Wenn ja: Sag es dem Nutzer und klaere,
  ob abgeloest oder ergaenzt werden soll, bevor du weitermachst.
- Wie werden Daten gehalten (Postgres, Dateien, nichts)? Der Standard
  braucht Ablage fuer Mandanten, Nutzer, Passkeys, Sitzungen, Challenges,
  Einladungen, Wiederherstellungs-Links und Gastzugaenge.
- **Die Domain der App** aus der prod-URL der devops.md — daraus ergibt
  sich die Absenderadresse `noreply@<domain>`.
- **Verschickt die App schon Mails?** Suche nach SMTP-Konfiguration oder
  einem Mailversand-Dienst. Wenn ja, nutze den vorhandenen Weg, statt
  einen zweiten daneben zu stellen. Wenn nein, gehoert der Versand ueber
  all-inkl (siehe Standard) ins Requirement — frag nicht danach, das ist
  entschieden.

### 2. Hoechstens drei Fragen

Stell nur, was du nicht lesen konntest und was das Ergebnis wirklich
aendert. Jede Frage mit Optionen und einer kurz begruendeten Empfehlung:

- **Wer nutzt die App?** Nur der Betreiber, auch eingeladene Personen,
  auch Gaeste? Danach richtet sich, welche der drei Zugangsarten gebaut
  werden. (Empfehlung: Mitglieder und Gaeste mitnehmen, auch wenn sie
  noch niemand braucht — sie nachtraeglich einzuziehen ist teurer als
  sie mitzubauen.)
- **Welche Umgebungen bekommen die Anmeldung?** Alle, oder vorerst nur
  prod? (Empfehlung: alle. Eine ungeschuetzte dev-Umgebung im Netz ist
  ein offener Zugang zu echten Daten.)
- **Worauf duerfen Gaeste zugreifen?** Nur wenn Gaeste gewuenscht sind:
  welcher Ausschnitt der App. (Empfehlung: so wenig wie moeglich, und
  nur lesend.)

Alles andere entscheidest du selbst nach dem Standard. Frag NICHT nach
Passwoertern als Alternative, nach der Cookie-Lebensdauer, nach der
Gueltigkeit des E-Mail-Links oder danach, ob Mandantentrennung noetig ist
— dafuer gibt es den Standard.

### 3. Requirement schreiben

Schreib nach `delivery/requirements/ready/req-NNN-<slug>.md` (naechste
freie Nummer ueber ALLE Unterordner von `delivery/requirements/`). Nutze
die Vorlage unten.

Drei Dinge, die den Unterschied machen:

- **Uebersetze den Standard in DIESEN Stack.** Nicht "wie in appbaua",
  sondern konkret: welche Dateien, welche Tabellen, welcher
  Schutzmechanismus des hier verwendeten Frameworks. Der Worker soll
  nicht raten muessen, und er kann appbaua nicht lesen.
- **Nenne die Umgebungen beim Namen.** rpId und Origin aus der devops.md
  gehoeren als konkrete Werte ins Requirement, nicht als Platzhalter.
- **Schneide immer in genau zwei Requirements**, in dieser Reihenfolge.
  Der volle Standard ist zu viel fuer eines, und ein freier Schnitt
  fuehrt dazu, dass jede App anders zerlegt wird:

  **Erstes Requirement — "Anmeldung und Zugang":** Mandantengeruest,
  Ersteinrichtung, Anmeldung per Conditional UI, "Meine Geraete",
  Wiederherstellung per E-Mail inklusive Mailversand, Schutz der ganzen
  App. Damit ist die App fuer den Betreiber allein vollstaendig nutzbar.

  **Zweites Requirement — "Weitere Nutzer und Gaeste":** Einladungen,
  die Bereiche "Nutzer" und "Gastzugaenge", Gastzugang per Link/QR
  inklusive Widerruf und Rollen.

  Das Mandantengeruest gehoert IMMER ins erste, auch wenn es dort noch
  niemand sieht: Es nachtraeglich einzuziehen heisst, jede Tabelle und
  jede Abfrage erneut anzufassen. Schreib beide Requirements in einem
  Zug und lege beide nach `ready/`; das zweite verweist im Goal auf das
  erste.

### 4. Uebergeben

Committe (`req-NNN: <Titel> ready`) und pushe. Sag dem Nutzer in ein, zwei
Saetzen, welche Nummer entstanden ist und was der Worker daraus bauen
wird. Weise auf das hin, was zutrifft:

- HTTPS muss stehen, bevor die Anmeldung nutzbar ist.
- `SMTP_USER` und `SMTP_PASSWORD` gehoeren in die env-Dateien beider
  Umgebungen — ohne sie gibt es keine Wiederherstellung. Nenne die
  Absenderadresse, die du festgelegt hast.
- Die Ersteinrichtung gehoert unmittelbar nach dem Deploy gemacht: Der
  Weg dorthin ist sichtbar, solange kein Nutzer existiert — also fuer
  jeden, der die URL kennt.

## Vorlage

```markdown
---
id: req-NNN
app: <repo-name>
area: <Area aus CLAUDE.md, falls das Repo Areas fuehrt>
created: <YYYY-MM-DD>
---

# Goal (Why)

<Warum diese App einen Zugangsschutz braucht — in einem Satz aus Sicht
des Betreibers. Dann: Sie folgt dem gemeinsamen Anmelde-Standard aller
Apps, damit ein Nutzer, der eine kennt, alle kennt.>

# Function (What)

<Der Standard, uebersetzt in DIESEN Stack. Konkret werden:>

**Anmelden**
- Beim Oeffnen der App erscheint sofort die Geraete-Entsperrung (Face ID
  / Touch ID / Windows Hello) — ohne dass vorher ein Knopf gedrueckt
  wird. Umgesetzt als Conditional UI (`mediation: "conditional"`,
  Anmeldefeld mit `autocomplete="username webauthn"`).
- `userVerification: "required"` und `residentKey: "required"`.
- Ein sichtbarer Anmeldeknopf bleibt als Rueckfallweg fuer Browser ohne
  Conditional UI.
- Ein angemeldeter Nutzer kann weitere Geraete hinzufuegen und sieht
  seine Geraete in einer Liste (Name, letzte Verwendung, entfernbar).

**Mandanten**
- Jeder Datensatz gehoert zu genau einem Mandanten; jede Abfrage filtert
  danach. Der Mandant kommt aus der Sitzung, nie aus der Anfrage.
- Der Bootstrap legt den ersten Mandanten an, der Betreiber ist Besitzer.
  Seine Adresse ist per Vorgabe `uwe@kremmel.org` (ueberschreibbar per
  `BOOTSTRAP_EMAIL`), damit der Wiederherstellungsweg ab der ersten
  Minute steht.
- Die Mandantenauswahl ist unsichtbar, solange ein Nutzer nur zu einem
  Mandanten gehoert.

**Wer hineinkommt**
- Keine offene Selbstregistrierung; weitere Nutzer nur ueber Einladung.
- Jedes Konto hat eine hinterlegte E-Mail-Adresse; die Einladung geht an
  sie. Ein Konto ohne Adresse kann nicht entstehen.
- Gastzugaenge per Link/QR ohne Passkey: zeitlich begrenzt,
  standardmaessig nur lesend, jederzeit widerrufbar (Widerruf wirkt
  sofort, auch fuer laufende Sitzungen). <Worauf Gaeste hier Zugriff
  haben.>

**Wiederherstellung**
- E-Mail-Link an die hinterlegte Adresse: 15 Minuten gueltig, einmalig,
  nur als Hash gespeichert, berechtigt ausschliesslich zur Registrierung
  eines neuen Passkeys. Antwort immer gleich, unabhaengig davon, ob die
  Adresse bekannt ist. Hoechstens 3 Anforderungen pro Stunde und Konto.
- Versand per SMTP ueber `w0089340.kasserver.com` (all-inkl), Port 587
  mit STARTTLS. Zugangsdaten aus `SMTP_USER`/`SMTP_PASSWORD` der
  env-Datei. Absender `<App-Name> <noreply@<app-domain>>`, konkret:
  <hier die Adresse fuer dieses Repo>. Ein fehlgeschlagener Versand
  aendert die Antwort der App nicht — er gehoert ins Log.

**Oberflaeche**
- Anmeldeseite mit `autocomplete="username webauthn"`-Feld; darunter
  kleiner: Anmeldeknopf als Rueckfallweg, "Anderes Geraet verwenden",
  "Zugang verloren". Solange kein Nutzer existiert, zusaetzlich
  "Ersteinrichtung starten" — danach nie wieder.
- "Meine Geraete": eigene Passkeys mit Name, Hinzugefuegt-am,
  Zuletzt-verwendet; hinzufuegen und entfernen. Ein entferntes Geraet
  verliert auch seine laufende Sitzung. Dazu "Ueberall abmelden", das
  alle Sitzungen beendet (Passkeys bleiben bestehen).
- "Abmelden" an gewohnter Stelle der App; beendet nur die Sitzung dieses
  Geraets, nicht den Passkey.
- "Nutzer" (nur Betreiber): Nutzer des Mandanten, Einladen per E-Mail,
  offene Einladungen zuruecknehmen, Nutzer entfernen.
- "Gastzugaenge" (nur Betreiber): erstellen (Zweck, Dauer, Umfang), Link
  als Text UND QR-Code — nur einmal sichtbar —, Liste mit Ablauf und
  "Widerrufen".
- Was ein Nutzer nicht darf, wird ihm nicht angezeigt; die Pruefung auf
  dem Server gilt trotzdem.

**Feste Zeiten**
- Sitzung 7 Tage (verlaengert sich bei Nutzung), Gast-Sitzung endet mit
  dem Gastzugang.
- Gastzugang: Vorgabe 7 Tage, hoechstens 90.
- Wiederherstellungs-Link 15 Minuten, Einladung 7 Tage, Challenge 5
  Minuten, hoechstens 3 Wiederherstellungs-Anforderungen pro Stunde und
  Konto.

**Technisch**
- Sitzung im httpOnly-Cookie, sameSite lax, secure ausserhalb localhost.
- Die ganze App ist geschuetzt; offen sind nur Anmeldung,
  Wiederherstellung, Gast-Einloesung und deren API-Routen.
- Passkeys je Umgebung getrennt: <konkrete rpId/Origin je Umgebung aus
  der devops.md>.

<Dazu: welche Ablage (Tabellen/Dateien) noetig ist und wo der Schutz im
hier verwendeten Framework ansetzt.>

# Acceptance Criteria

- [ ] Given ich bin auf diesem Geraet bekannt, when ich die App oeffne,
  then erscheint die Geraete-Entsperrung (Face ID / Touch ID / Windows
  Hello) von selbst, ohne dass ich vorher einen Knopf druecke.
- [ ] Given mein Browser kann kein Conditional UI, when ich die App
  oeffne, then sehe ich einen Anmeldeknopf, der zum selben Ziel fuehrt.
- [ ] Given ich bin auf dem iPhone angemeldet, when ich die App auf dem
  Windows-PC oeffne und dort einen Passkey hinzufuege, then kann ich
  mich auf beiden Geraeten anmelden.
- [ ] Given ein Geraet ohne Passkey-Faehigkeit, when ich "anderes Geraet
  verwenden" waehle und den QR-Code mit dem Handy scanne, then bin ich
  auf diesem Geraet angemeldet.
- [ ] Given eine frisch deployte Umgebung ohne Nutzer, when ich die App
  aufrufe, then sehe ich "Ersteinrichtung starten" und kann darueber
  ohne Kommandozeile einen Mandanten, den Betreiber mit hinterlegter
  Adresse (`uwe@kremmel.org`, sofern nicht anders gesetzt) und dessen
  ersten Passkey anlegen.
- [ ] Given es existiert bereits ein Nutzer, when ich die Anmeldeseite
  aufrufe, then ist "Ersteinrichtung starten" nicht mehr vorhanden —
  auch nicht ueber die direkte URL.
- [ ] Given ein frisch per Bootstrap angelegter Betreiber, when er sofort
  einen Wiederherstellungs-Link anfordert, then kommt dieser an — der
  Weg zurueck steht also ab der ersten Minute.
- [ ] Given ich bin nicht angemeldet, when ich eine geschuetzte Seite
  direkt aufrufe, then sehe ich die Anmeldeseite und NICHT den Inhalt.
- [ ] Given Daten eines anderen Mandanten, when ich dessen ID in der URL
  angebe, then bekomme ich sie NICHT zu sehen.
- [ ] Given jemand ohne Einladung, when er sich zu registrieren
  versucht, then wird das abgelehnt.
- [ ] Given ich bin Betreiber, when ich unter "Nutzer" jemanden per
  E-Mail einlade, then bekommt diese Person einen Link und kann damit
  einen eigenen Passkey registrieren; die offene Einladung ist mir mit
  Ablaufdatum angezeigt und laesst sich zuruecknehmen.
- [ ] Given ich bin Mitglied und nicht Betreiber, when ich die App
  benutze, then sehe ich "Nutzer" und "Gastzugaenge" nicht — und ein
  direkter Aufruf ihrer Adressen wird ebenfalls abgelehnt.
- [ ] Given ich bin Betreiber, when ich einen Gastzugang erstelle, then
  sehe ich den Link als Text und als QR-Code, zusammen mit dem Hinweis,
  dass er nur jetzt sichtbar ist — und spaeter finde ich ihn nirgends
  wieder.
- [ ] Given ich habe genau einen Passkey und keine hinterlegte
  E-Mail-Adresse, when ich diesen Passkey entfernen will, then wird das
  abgelehnt, damit ich mich nicht selbst aussperre.
- [ ] Given ich bin angemeldet, when ich "Abmelden" waehle, then ist die
  App gesperrt — und beim naechsten Oeffnen komme ich per Face ID wieder
  hinein, ohne den Passkey neu einzurichten.
- [ ] Given ich bin auf dem iPad und auf dem Laptop angemeldet, when ich
  auf dem Laptop unter "Meine Geraete" das iPad entferne, then ist das
  iPad sofort abgemeldet und zeigt beim naechsten Aufruf die
  Anmeldeseite.
- [ ] Given ich bin auf mehreren Geraeten angemeldet, when ich "Ueberall
  abmelden" waehle, then sind alle Geraete abgemeldet — auch das, an dem
  ich gerade sitze — und meine Passkeys funktionieren weiterhin.
- [ ] Given ich habe mein Geraet verloren, when ich einen
  Wiederherstellungs-Link anfordere und oeffne, then kann ich einen
  neuen Passkey registrieren — und der Link ist danach verbraucht.
- [ ] Given ein Wiederherstellungs-Link ist aelter als 15 Minuten, when
  ich ihn oeffne, then wird er abgelehnt.
- [ ] Given eine unbekannte E-Mail-Adresse, when ich damit einen Link
  anfordere, then unterscheidet sich die Antwort der App nicht von der
  bei einer bekannten Adresse.
- [ ] Given ein Gastlink, when der Gast ihn oeffnet, then sieht er den
  freigegebenen Ausschnitt ohne Passkey — und nichts darueber hinaus.
- [ ] Given ein abgelaufener oder widerrufener Gastlink, when er
  geoeffnet wird, then wird der Zugriff abgelehnt; eine laufende
  Gast-Sitzung endet beim Widerruf sofort.
- [ ] Given ich registriere einen Passkey auf <dev-URL>, when ich mich
  auf <prod-URL> anmelden will, then gilt er dort NICHT.

# Constraints

- WebAuthn funktioniert nur im "secure context": Jede ueber das Netz
  erreichbare Umgebung braucht gueltiges TLS. `localhost` gilt als
  sicher.
- Conditional UI setzt Discoverable Credentials voraus
  (`residentKey: "required"`) — ohne die kann der Browser den passenden
  Passkey vor der Anmeldung nicht finden.
- Die Wiederherstellung braucht `SMTP_USER` und `SMTP_PASSWORD` in der
  env-Datei der jeweiligen Umgebung. Ohne sie laesst sich kein Link
  verschicken — der Betreiber traegt sie nach dem Deploy ein.
- Die Ersteinrichtung laeuft ueber die Oberflaeche und ist nur sichtbar,
  solange kein Nutzer existiert — kein Kommandozeilen-Befehl, kein
  Startwert in der Konfiguration. Sie gehoert unmittelbar nach dem Deploy
  gemacht: bis dahin koennte sie jeder ausloesen, der die URL kennt.

# Out of Scope

- Passwort-Login, offene oeffentliche Registrierung.
- Feingliedrige Rollen- und Rechteverwaltung ueber Betreiber, Mitglied
  und Gast hinaus.
- <Externer Zugang / Tunnel / Reverse-Proxy, falls das hier ein eigenes
  Requirement ist.>
```

## Was du NIE tust

- Die Anmeldung selbst implementieren. Dieser Skill schreibt ein
  Requirement; gebaut wird es vom Worker dieses Repos.
- Vom Standard abweichen, ohne dass der Nutzer es verlangt hat — und ohne
  die Abweichung sichtbar ins Requirement zu schreiben.
- Passwoerter als Alternative anbieten. Fuer Geraete ohne Passkey gibt es
  drei Wege (anderes Geraet per QR, E-Mail-Link, Gastzugang) — ein
  Passwort ist keiner davon.
- Mandantentrennung weglassen, weil es "vorerst nur einen Mandanten
  gibt". Genau dann ist sie billig; spaeter ist sie teuer.
- Notfallcodes zum einzigen Wiederherstellungsweg machen. Sie gehen
  verloren; der E-Mail-Link ist der Hauptweg.
- Die Sitzung verlaengern, damit der Nutzer sich seltener anmelden muss.
  Die Anmeldung dauert eine Sekunde — laenger offen zu bleiben kauft
  keine Bequemlichkeit, sondern verlaengert nur das Fenster, in dem ein
  verlorenes Geraet noch hineinkommt.
- Einen Passkey entfernen, ohne dessen Sitzungen zu beenden. Wer ein
  Geraet entfernt, will es draussen haben — nicht erst in einer Woche.
- Eine bestehende Anmeldung stillschweigend ueberschreiben. Erst sagen,
  was da ist, dann klaeren.
