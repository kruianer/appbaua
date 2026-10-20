---
type: code-review
repo: AppBaua
commit: aa5e9b9
date: 2026-10-06
---

# Code-Review: AppBaua (aa5e9b9)

Automatisch erstellt vom appbaua-Worker am 2026-10-06.

All checks complete, working tree clean. Here is the report.

---
```
---
type: code-review
repo: appbaua
commit: aa5e9b9
date: 2026-10-06
---
```

# Code-Review appbaua (Branch `dev`, Stand aa5e9b9)

Bezug: [delivery/reviews/2026-09-29-code-review-appbaua-305cddc.md](delivery/reviews/2026-09-29-code-review-appbaua-305cddc.md).

Seitdem sind zwei Commits gelandet, **beide ohne eine Zeile Code**: `79274df` (Security-Bericht) und `aa5e9b9` (eine Idee). `git diff --stat 4b84e3e..HEAD` → 2 Dateien, 306 Zeilen, ausschließlich Markdown. Gegenüber dem zuletzt gereviewten Stand `305cddc` sind es drei Dokumente und 503 Zeilen, ebenfalls ohne Code.

Damit gibt es heute keinen Diff zu lesen. Ich habe die Zeit stattdessen in zwei Dinge gesteckt: die zwanzig Vorbefunde einzeln am heutigen Code nachgeprüft (**alle zwanzig unverändert offen**), und danach den einen Teil des Codes gelesen, den in zehn Review-Berichten noch nie jemand angesehen hat. Gezählt: `lib/auth-*.ts` wird in `delivery/reviews/*.md` **null mal** erwähnt — zwölf Module, der komplette Passkey-Stack aus req-023/req-031, und damit genau der Code, hinter dem die Befunde 1 und 15 seit acht Berichten als „fehlt" vermerkt sind. Dort stehen die beiden kritischen Neubefunde dieses Berichts. Beide habe ich mit einem Prüfstand belegt, nicht nur gelesen; der lief, war grün, und ist wieder gelöscht (`git status` sauber).

**Quality Gate (live gefahren):** `NODE_ENV=test npx vitest run` → **1179/1179 grün**, 9 übersprungen, 76 Testdateien — Zahl für Zahl identisch zur letzten Woche, wie bei unverändertem Code zu erwarten. `npm run typecheck` sauber. `npm run lint` unverändert dieselben 5 `react-hooks/exhaustive-deps`-Warnungen in `components/TaskControl.tsx` (61, 77, 87, 109, 157), plus die Deprecation-Warnung von `next lint`. `npm audit --json` → **`{high: 4, critical: 1, total: 5}`** — das ist **eine mehr als letzte Woche**, siehe Befund 12.

---

## Kritisch

### 1. NEU: `finishRegistrationAndSignIn` meldet anhand eines Feldes an, das der Angreifer frei setzt — Kontoübernahme

Das ist der schwerste Fund dieses Berichts, und er ist eine einzige Zeile.

`lib/auth-finish-registration.ts:23-29`:

```ts
const result = await finishRegistration(token, response);
if (!result.ok) return { ok: false, error: result.error };

const cred = await getAuthStore().getCredential(response.id);
if (!cred) return { ok: false, error: "verification-failed" };

await signIn(cred.userId);
```

`finishRegistration` verifiziert die Zeremonie korrekt und legt das Credential unter der **verifizierten** ID ab (`lib/auth-webauthn.ts:121-130`: `credential.id` aus `verification.registrationInfo`). Danach gibt es nur `{ ok: true }` zurück — die ID behält es für sich. Also schlägt der Aufrufer sie ein zweites Mal nach, und zwar unter `response.id`: dem rohen, ungeprüften Feld aus dem Request-Body. Wen `signIn` anmeldet, entscheidet damit nicht die Kryptographie, sondern ein String, den der Client schreibt.

**Die Bibliothek deckt diese Lücke nicht.** Nachgelesen in `node_modules/@simplewebauthn/server/esm/registration/verifyRegistrationResponse.js` — die Datei fasst `response.id` genau einmal an, Zeile 42: `if (id !== rawId) throw new Error('Credential ID was not base64url-encoded')`. Beide Felder kommen aus demselben Request, beide darf der Angreifer setzen. Die ID, die als verifiziert zurückgegeben wird, stammt dagegen aus dem Attestation-Blob: Zeile 199, `id: isoBase64URL.fromBuffer(credentialID)`, und `credentialID` kommt aus `parsedAuthData` (Zeile 100). **Ein Abgleich von `response.id` gegen `authData.credentialID` findet nirgends statt.** Beide dürfen auseinanderlaufen, und die Verifikation geht trotzdem durch.

Der Angriff, Schritt für Schritt:

1. Der Angreifer hält eine gültige Registrierungs-Zeremonie — er ist ein regulär eingeladener Nutzer (req-023 sieht Nicht-Betreiber-Nutzer ausdrücklich vor) oder löst einen Backup-Code ein.
2. Er registriert einen **echten** Passkey mit seinem **echten** Authenticator. Challenge, Origin, rpIdHash, Attestation-Signatur — alles korrekt, nichts davon muss gefälscht werden.
3. Vor dem POST ändert er im JSON zwei Felder: `id` und `rawId`, beide auf die Credential-ID des Opfers. `attestationObject` und `clientDataJSON` bleiben unangetastet.
4. `verifyRegistrationResponse` verifiziert. `finishRegistration` legt das Credential des Angreifers unter dem Nutzer des Angreifers ab und meldet `ok`.
5. `getCredential(response.id)` liefert die Zeile des **Opfers**.
6. `signIn(cred.userId)` setzt ein Sitzungs-Cookie für das Opfer.

Belegt, nicht hergeleitet. Mein Prüfstand hat einen Betreiber mit Passkey, einen eingeladenen Nicht-Betreiber-Nutzer mit gültigem Registrierungs-Token, und eine Antwort, in der nur `id`/`rawId` auf `victim-cred` zeigen:

```
expect(result.ok).toBe(true);
expect(signedInAs).toEqual(["operator"]);   // grün
```

Der eingeladene Gast bekommt eine Betreiber-Sitzung. Damit fällt genau die Grenze, die req-023 an einer anderen Stelle ausdrücklich zieht — `app/api/auth/invitations/route.ts:10` prüft `user?.isOperator`, mit dem Kommentar „weil ein Nicht-Betreiber-Nutzer niemals in der Lage sein darf, eigenständig weitere Leute einzuladen". Über diesen Weg kann er es.

**Was den Angriff bremst, ehrlich benannt:** Der Angreifer muss die Credential-ID des Opfers kennen. Diese App gibt sie nirgends heraus — der Login ist usernameless, `startLogin` liefert keine `allowCredentials`, und `excludeCredentials` (`lib/auth-webauthn.ts:83`) zeigt einem Nutzer nur seine eigenen. Das ist heute die einzige Hürde, und sie ist eine Hürde aus Verschwiegenheit, keine aus Kryptographie: Credential-IDs sind im WebAuthn-Modell öffentliche Bezeichner, sie stehen in `allowCredentials` jedes nicht-usernameless Flows, und sie liegen im Klartext in `.data/auth.json` bzw. in `auth_credentials`. Eine Authentifizierung, die darauf beruht, dass ein öffentlich gedachter Bezeichner geheim bleibt, ist ein Befund, nicht eine Härtung.

Dazu der Fall ohne jeden Angreifer: zeigt `response.id` auf **kein** vorhandenes Credential, ist die Antwort `verification-failed` — **obwohl die Verifikation erfolgreich war und das Credential schon gespeichert ist**. Die Challenge ist verbraucht, der Passkey liegt in der Datenbank, der Nutzer liest „fehlgeschlagen". Beim zweiten Versuch weist ihn sein eigener Browser über `excludeCredentials` ab, weil dieses Gerät ja bereits registriert ist. Auf dem Recovery-Pfad kostet dieser Durchgang zusätzlich einen Backup-Code (Befund 3).

**Fix:** `finishRegistration` gibt die verifizierte `credential.id` (oder gleich `userId`) mit zurück, und `finishRegistrationAndSignIn` benutzt sie statt `response.id`. Die Information liegt in `lib/auth-webauthn.ts:121` schon vor und wird nur weggeworfen. Das Lookup über den Store entfällt damit ganz — `ceremony.userId` ist der Nutzer, um den es geht, und er stand von Anfang an fest.

**Warum das zehn Berichte überlebt hat:** `lib/auth-webauthn.test.ts:22-35` setzt `fakeRegResponse = { id: "cred1" }` und `credential.id = "cred1"`. Die beiden Werte sind im Test per Konstruktion identisch — der einzige Fall, in dem die Verwechslung nicht auffällt, ist der einzige, den die Tests fahren.

### 2. NEU: Ein einziger unauthentifizierter POST sperrt die Installation dauerhaft zu

`bootstrapOperator` (`lib/auth-bootstrap.ts:27-42`) prüft `countUsers() > 0`, legt dann den Betreiber-Nutzer an und startet erst danach die Zeremonie:

```ts
if ((await store.countUsers()) > 0) return { ok: false, error: "already-bootstrapped" };
...
await store.createUser(user);
const registration = await startRegistration(user.id, "Betreiber", now);
```

Der Passkey entsteht aber erst in `bootstrap/finish`, und die Backup-Codes auch (`app/api/auth/bootstrap/finish/route.ts:11-13`, `withBackupCodes: true`). Bricht zwischen Start und Finish irgendetwas ab, bleibt dieser Zustand stehen:

- `countUsers()` ist 1 → die Ersteinrichtung ist **ab sofort und endgültig** geschlossen,
- der Nutzer hat **kein** Credential → `finishLogin` findet nichts, Login unmöglich,
- er hat **keinen** Backup-Code → Recovery unmöglich,
- eine Einladung braucht `currentUser()?.isOperator`, also eine Sitzung → unmöglich.

Es gibt keinen vierten Weg: `startRegistration` wird im ganzen Produktionscode nur aus `bootstrapOperator`, `redeemInvitation` und `redeemBackupCode` gerufen, und eine Route zum Nachregistrieren eines Geräts existiert nicht (`app/api/auth/register/` ist leer). Die Installation ist ohne Eingriff in die Datenbank nicht mehr erreichbar.

Prüfstand, grün:

```
expect(await store.countUsers()).toBe(1);                          // Nutzer existiert
expect(await store.listCredentialsForUser(op.id)).toEqual([]);     // kein Passkey
expect(await store.listBackupCodesForUser(op.id)).toEqual([]);     // kein Backup-Code
expect(await bootstrapOperator()).toEqual({ ok: false, error: "already-bootstrapped" });
```

**Wie leicht das passiert — zwei Wege, und der harmlose ist der wahrscheinlichere.**

Der harmlose: Der Betreiber öffnet auf einer frischen Umgebung „Ersteinrichtung starten", und die Zeremonie kommt nicht durch — Face ID abgelehnt, Tab geschlossen, Authenticator-Fehler, iOS-Dialog weggewischt. Der Nutzer ist angelegt, der Passkey nicht. Und die Oberfläche führt ihn jetzt aktiv in die Irre: `app/login/page.tsx:83` zeigt den Link zur Ersteinrichtung nur bei `bootstrapped === false`, und `bootstrap/status` meldet ab jetzt `true`. Der Link **verschwindet**. Übrig bleiben „Mit Passkey anmelden" (es gibt keinen) und „Mit Backup-Code wiederherstellen" (es gibt keinen). Kein Hinweis, keine Fehlermeldung, nur zwei Knöpfe, die nicht funktionieren können.

Der feindliche: `POST /api/auth/bootstrap/start` ist **öffentlich**. `middleware.ts:22` stellt den gesamten Präfix `/api/auth` frei, und diese Route prüft nichts — `POST()` nimmt keinen Body, keinen Token, keinen Header. Nach `delivery/devops.md` hängen dev und prod je an einem Cloudflare-Tunnel im Internet. Ein `curl -X POST https://<umgebung>/api/auth/bootstrap/start` gegen eine frische oder neu aufgesetzte Umgebung brickt die Anmeldung, bevor der Betreiber sie zum ersten Mal öffnet. Ein Request, kein Rate-Limit (Befund 5), nichts zu erraten.

Der Kommentar über `bootstrapOperator` argumentiert ausschließlich gegen den *zweiten* Betreiber („so cannot be used to sneak in a second operator later") — die Richtung ist abgesichert. Die andere Richtung, dass derselbe Mechanismus den *ersten* Betreiber aussperrt, ist nicht bedacht.

**Fix:** Das Tor ist die falsche Bedingung. `countUsers()` zählt Nutzer; interessant ist, ob schon jemand **einen Passkey** hat. Ein `countCredentials() === 0` (bzw. „kein Nutzer mit Credential") als Vorbedingung macht die Ersteinrichtung wiederholbar, solange sie nie abgeschlossen wurde, und schließt sie in der Sekunde, in der der erste Passkey liegt — die Absicherung gegen den zweiten Betreiber bleibt dabei vollständig erhalten. Saubere Variante dazu: den Nutzer erst in `finish` anlegen und die Zeremonie bis dahin ohne `userId` führen, dann entsteht die halbfertige Zeile gar nicht. `bootstrap/status` muss dieselbe Bedingung beantworten, sonst bleibt der Link weiterhin unsichtbar.

### 3. Middleware prüft weiterhin nur „Cookie vorhanden" — neuntes Review in Folge

`middleware.ts:38` unverändert: `Boolean(request.cookies.get(SESSION_COOKIE)?.value)`, sonst nichts. Heute gezählt: `find app/api -name route.ts` → **33** Routen; `grep -rln "userIdForSession\|currentUser" app/api/` findet die zweite Prüfung in **3** davon (`auth/me`, `auth/invitations`, `auth/backup-codes`). Das Verhältnis 3:33 ist seit neun Berichten unverändert.

Unverändert dahinter: `app/api/health/restart` startet einen fremden prod-Container neu und prüft im Handler nur `typeof body.repoId !== "string" || typeof body.container !== "string"`. Dazu `health/analyze` (gibt Geld beim KI-Anbieter der fremden App aus, ohne Rate-Limit), `health/settings` und `repos/[id]/monitored` (schalten die Überwachung stumm), `repos/*` (inkl. `appbaua`-Rollout mit Push per gespeichertem PAT), `worker-state/*`, `task-types/*`.

Neu einzuordnen ist das vor dem Hintergrund von Befund 1: Die Middleware ist als „defence in depth" dokumentiert (`middleware.ts:4-12`, „the real check happens in the auth API routes and page server components"). Dieser zweite Check existiert in 3 von 33 Routen — und Befund 1 zeigt, dass der Weg zu einem *echten*, von der App selbst ausgestellten Cookie kürzer ist als gedacht. Die beiden Befunde stützen sich gegenseitig: Befund 1 beschafft die Sitzung, Befund 3 stellt sicher, dass danach niemand mehr fragt.

**Fix:** unverändert — `userIdForSession`/`currentUser` in einen gemeinsamen Wrapper, über jede nicht-öffentliche Route.

### 4. Die geretteten Etappen werden beim nächsten Lauf weiterhin vernichtet

**Unverändert.** `checkoutTracking` (`lib/workspace.ts:503-515`) endet weiterhin mit `git reset --hard origin/<branch>` und wird weiterhin aus `prepareRepo` gerufen (`:580`, `:612`), also zu Beginn **jedes** Schritts. `reset --hard` **mit Ziel** wirft lokale Commits weg, die das Remote nicht hat — exakt die Etappen, die `keepStages`/`pushStages` gerettet haben, wenn deren Push scheiterte. Der Kommentar bei `:719` (`reset --hard` **ohne** Ziel) argumentiert weiterhin über den anderen Fall und deckt diesen nicht ab.

Weiterhin der teuerste offene Punkt nach Befund 3: zwei Commits und ein Docker-Volume für die Rettung von Etappen, und der Vernichter steht unangetastet daneben.

### 5. Zwei Netzwerk-Erkennungen widersprechen sich weiterhin

**Unverändert.** `grep -c errorKindOf lib/network-abort.ts` → **0**. `isNetworkAbort` (`:69-72`) prüft weiterhin nur `isClaudeTimeout` und läuft danach über eine eigene Wortlaut-Liste, ohne die in `lib/error-kind.ts` begründete Reihenfolge („Testsuite vor Netzwerk", Kategorie „Rechner am Limit"). Ein Container, der nicht mehr forken kann (`ENOMEM`/`EAGAIN`), wird weiterhin als Netzstörung behandelt und legt dreimal den kompletten Pass still — in genau dem Maschinenzustand, den bug-023 dokumentiert hat. Der Fix bleibt der Einzeiler: `isNetworkAbort` auf `errorKindOf(text) === "network"` zurückführen.

Nebenbei unverändert: `lib/network-abort.ts:55` sagt „60 minutes", seit `ac2c9b6` sind es 120.

---

## Wichtig

### 6. NEU: `redeemBackupCode` verbrennt den Code, bevor klar ist, ob die Wiederherstellung klappt

`lib/auth-recovery.ts:76-84`:

```ts
const match = await store.findBackupCodeByHash(wanted);
if (!match) return { ok: false, error: "invalid-code" };

await store.consumeBackupCode(match.id);
const registration = await startRegistration(match.userId, "Wiederhergestellter Zugang", now);
```

Der Code ist weg, sobald er vorgezeigt wurde. Die Zeremonie, für die er bezahlt hat, fängt danach erst an — und sie kann aus jedem der üblichen Gründe scheitern: Nutzer bricht den Face-ID-Dialog ab, Authenticator mag nicht, Seite neu geladen, Challenge nach 5 Minuten (`CHALLENGE_TTL_MS`) abgelaufen. Jeder dieser Durchgänge kostet einen von zehn Codes und bringt nichts ein.

Das ist ein Lockout-Pfad, und zwar derselbe Endzustand wie Befund 2: Wer sein Gerät verloren hat und die Zeremonie zehnmal nicht durchbringt, hat keinen Passkey, keinen Code und keine Sitzung mehr — und neue Codes gibt es nur über `POST /api/auth/backup-codes`, das `currentUser()` verlangt. Zehn Fehlversuche in dem Moment, in dem jemand ohnehin auf einem fremden Gerät hantiert, sind nicht unrealistisch. Verschärfend kommt Befund 1 dazu: dort scheitert `finish` mit `verification-failed`, *obwohl* alles verifiziert wurde — auch dieser Durchgang kostet einen Code.

**Fix:** erst die Zeremonie, dann der Verbrauch. Den Code an die Challenge binden (die Tabelle hat `token`, `userId`, `purpose` schon) und ihn in `finishRegistrationAndSignIn` entwerten, wenn das Credential wirklich liegt. Billigere Zwischenstufe: beim Start nur prüfen und den Treffer merken, beim Finish verbrauchen — dann kostet ein Abbruch nichts.

### 7. NEU: Challenges und Sitzungen werden nie aufgeräumt — und `login/start` ist öffentlich

Keiner der beiden Stores räumt ab. Nachgesehen: die einzigen `DELETE` auf diesen Tabellen sind `lib/pg-store.ts:739` (`auth_sessions WHERE id = $1`, Logout) und `:765` (`auth_challenges WHERE token = $1`, Verbrauch). Es gibt kein `expires_at <`, keine Retention, keinen Aufräum-Takt — `grep` über alle `.ts`/`.sql` findet nichts.

Für Sitzungen heißt das: `userIdForSession` (`lib/auth-session.ts:47`) **erkennt** eine abgelaufene Sitzung und gibt `null` zurück, **löscht** sie aber nicht. Bei `SESSION_TTL_MS` von 30 Tagen wächst `auth_sessions` monoton mit jeder Anmeldung, die nicht per Logout endet.

Für Challenges ist es schärfer, weil der Erzeuger unauthentifiziert ist. `POST /api/auth/login/start` ist über `middleware.ts:22` öffentlich, nimmt keinen Body und legt bei jedem Aufruf eine Zeile an (`storeChallenge`, `lib/auth-webauthn.ts:30-45`). Gelöscht wird eine Zeile **nur**, wenn ihr Token später bei `finish` vorgezeigt wird. Eine abgebrochene Zeremonie — und ein Angreifer bricht grundsätzlich ab — bleibt für immer stehen. `CHALLENGE_TTL_MS` wird ausschließlich lesend geprüft (`:56`) und hat auf die Lebensdauer der Zeile keinen Einfluss.

Die Folgen unterscheiden sich je Store, und das gehört auseinandergehalten:

- **Postgres** (Produktion, `DATABASE_URL` gesetzt): unbegrenztes Tabellenwachstum. Lästig, nicht akut — die Abfragen gehen über den Primärschlüssel.
- **File-Store** (`lib/auth-store.ts:75-197`, der dev-Rückfall ohne DB nach `delivery/stack.md`): **jede** Auth-Operation ist `readAll()` + `writeAll()`, also ein vollständiger `JSON.parse` und ein vollständiges `JSON.stringify` der ganzen Datei — bei `createChallenge` ebenso wie bei `getSession`. Jeder unauthentifizierte `login/start` macht die Datei größer und damit **jede künftige Anmeldung** langsamer. Das ist ein Denial-of-Service, den ein Fremder von außen mit einer Schleife auslöst, ohne irgendetwas zu wissen oder zu erraten.

Ohne Rate-Limit (Befund 5) gibt es nichts, was das bremst.

**Fix:** Aufräumen beim Lesen (`consumeChallenge` löscht gleich alles mit `expires_at < now()`; `userIdForSession` löscht die abgelaufene Zeile, die es gerade abgelehnt hat) — das kostet keinen zusätzlichen Takt und ist das Muster, das die anderen Stores schon verwenden. Dazu `ON DELETE`-Retention wie bei den Logs.

### 8. NEU: Keine einzige Auth-Route hat ein Rate-Limit oder eine Sperre

`grep -rln "rateLimit\|rate_limit\|throttle\|attempts\|lockout" app/api lib/auth-*.ts middleware.ts` → **kein Treffer**. Nicht in `recovery/start` (Backup-Code-Eingabe), nicht in `login/start`/`login/finish`, nicht in `bootstrap/start`, nicht in `invitations/[token]/start`.

Für den Backup-Code selbst ist das vertretbar, und das sollte man anerkennen: `randomBytes(10)` sind 80 Bit, da führt Raten zu nichts. Was fehlt, ist die Flankendeckung für alles andere — Befund 2 braucht genau einen Request, Befund 7 braucht viele und wird von niemandem gebremst, und `recovery/start` ist ein unauthentifizierter Endpunkt, der bei jedem Aufruf einen Hash-Scan über die Codes aller Nutzer fährt (`findBackupCodeByHash`, im File-Store samt vollständigem Dateilesen).

Nach `delivery/devops.md` steht beides im Internet. Ein Zähler pro IP über die Routen unter `/api/auth` ist eine kleine Mittelschicht und schließt den billigen Teil von drei Befunden gleichzeitig.

### 9. NEU: Das Sitzungs-Cookie hat keine Lebensdauer — 30 Tage serverseitig, bis zum Schließen des Browsers im Client

`SESSION_COOKIE_OPTIONS` (`lib/auth-cookie-name.ts:10-15`) setzt `httpOnly`, `sameSite`, `secure`, `path` — und **kein** `maxAge`/`expires`. Ein Cookie ohne beides ist ein Session-Cookie: es stirbt mit dem Browser. Serverseitig lebt die Sitzung dagegen `SESSION_TTL_MS` = 30 Tage (`lib/auth-types.ts:61`).

Die zwei Zahlen treffen sich nie. Praktisch heißt das: der Nutzer muss sich nach jedem Browserneustart neu anmelden, während die alte Sitzungszeile 30 Tage gültig im Store weiterliegt (und nach Befund 7 danach auch noch). Die 30 Tage, die der Code als Absicht hinschreibt, erlebt niemand.

req-023 schreibt unter „Session" nur „besteht eine Sitzung (Session-Cookie); Logout beendet sie" — man kann das als erfüllt lesen. Zwei Dinge sprechen trotzdem dagegen, es so zu lassen: Erstens ist die App nach `delivery/stack.md` ausdrücklich auf iOS/iPadOS gedacht, und dort ist der Entzug eines Session-Cookies aggressiv — eine Passkey-Abfrage pro App-Start ist genau die Reibung, die der `setup-auth`-Standard („beim Öffnen sofort die Geräte-Entsperrung") vermeiden will, aber nicht als Dauerzustand. Zweitens, und wichtiger: Wer `SESSION_TTL_MS = 30 days` liest, hält die Lebensdauer für geregelt. Sie ist es an einer Hälfte.

Dazu, kleiner: Eine Sitzung wird nie verlängert. Nach 30 Tagen fällt auch ein täglich aktiver Nutzer heraus.

### 10. `npm audit`: jetzt 1 kritisch + **4** high — dritte Woche mit demselben Zwei-Schritte-Rezept, und ein Paket mehr

Live gemessen: `{high: 4, critical: 1, total: 5}` über `nanoid`, `next`, `postcss`, `sharp` und **neu `source-map-js`** (high, CVSS 7.5 — „event-loop denial of service through indexed source-map section offsets", `fixAvailable: true`). Die anderen vier unverändert: `next` critical (2× unauth. RCE), `postcss` high (4 Advisories), `sharp` high, `nanoid` high. Alle fünf mit verfügbarem Fix.

Der Weg steht seit drei Berichten vollständig aufgeschrieben: (a) `npm audit fix` hebt `nanoid`/`sharp`/`postcss`/`source-map-js` innerhalb der bestehenden Ranges; (b) `images: { unoptimized: true }` in `next.config.ts` schaltet den Image-Optimizer ab, den diese App nirgends benutzt, und macht die kritische AVIF-Bewertung gegenstandslos, ohne auf `next@16` zu warten.

Nachgeprüft: `grep -n images next.config.ts` → **kein Treffer**. Die Windows-RCE trifft weiterhin nicht zu (Alpine); die AVIF-RCE sitzt weiterhin im Optimizer, und `/_next/image` ist weiterhin der eine Serverpfad, den der Middleware-Matcher (`middleware.ts:54`) ausdrücklich ausnimmt.

Dass die Liste in einer Woche **ohne jede Code-Änderung** um einen High-Befund gewachsen ist, ist der eigentliche Punkt: Diese Zahl steigt von allein, und die Viertelstunde, die sie senkt, ist seit drei Berichten dieselbe.

### 11. NEU/verschärft: 7 von 246 Akzeptanzkriterien in `done/` sind abgehakt

Der letzte Bericht hielt fest, req-036/037 lägen „mit 0 gesetzten Häkchen in `done/`". Heute über alle 38 Dateien gezählt:

- **7 von 246** Kriterien in `delivery/requirements/done/` tragen ein `[x]`,
- **37 von 38** Dateien haben **null** abgehakte Kriterien,
- die einzige vollständig abgehakte ist `req-030-repo-zeile-aufklappbar.md` (7/7).

Darunter ist req-023 selbst: alle Kriterien offen, inklusive „Given eine leere Umgebung ohne Nutzer, when der Betreiber-Bootstrap einmalig ausgeführt wird, then existiert ein Betreiber-Nutzer, mit dem ein erster Passkey registriert werden kann" — das Kriterium, dessen Lücke Befund 2 ist.

Das ist kein Formalismus. Nach `delivery/stack.md` ist ein Requirement ohne Test für sein Verhalten nicht fertig, und das Häkchen ist der Ort, an dem „geprüft" von „gebaut" unterschieden wird. Bei 7 von 246 trägt der Ordnername `done/` die ganze Aussage allein. Die beiden kritischen Befunde dieses Berichts sitzen beide in einem Requirement, das in `done/` liegt und dessen Kriterien keines angehakt hat — und beide wären an einem Kriterium aufgefallen, das jemand wirklich durchgespielt hätte.

### 12. Der Doku- und der recurring-Task committen weiterhin fremde Änderungen

**Unverändert.** `discardChanges` steht in `lib/execute-step.ts` an den Zeilen 266 (`keepStages`), 576 (idea), 593 (security) und 816 (`parkFailed`). Der `doc`-Zweig und der recurring-/file-Zweig rufen es weiterhin **nicht**. Da `commitAndPush` intern `git add -A` macht und seit req-036 alle lokalen Commits mitpusht, landet unter „worker: Doku aktualisiert" weiterhin alles, was der Lauf sonst angefasst hat.

### 13. Der abgelegte Bericht geht weiterhin unredigiert ins Repo

**Unverändert.** `grep -c redact lib/execute-step.ts` → weiterhin **0**. `fileReport` schreibt `report` unverändert ins Repo — auch dieses Dokument nimmt diesen Weg. Jedes andere neue Modul macht es an der vergleichbaren Stelle richtig.

### 14. `run()` läuft in zwei Prozessen, verdrahtet ist einer

**Unverändert.** `grep -rn installProcessTreeCleanup` findet den Aufruf weiterhin genau einmal, in `worker/index.ts:12`. `instrumentation.ts` — heute noch einmal vollständig gelesen, die einzige Stelle, an der der Web-Prozess etwas hochfährt — startet `startTelegramMonitor()` und `startHeartbeat()` und ruft `installProcessTreeCleanup()` nicht. Der Weg `app/api/repos/[id]/appbaua/route.ts` → `convertRepoToAppbaua` → `queueAppbauaStandard` → `prepareRepo`/`commitAndPush` benutzt `run()` weiterhin im Next.js-Serverprozess.

Die Einschränkung aus dem letzten Bericht gilt unverändert: `installProcessTreeCleanup()` registriert auch `target.exit?.(0)` auf SIGTERM (`lib/workspace.ts:211`) und würde im Web-Prozess Next.js' eigenes Herunterfahren überholen. Der Schnitt bleibt: `exit`-Teil überall, Signal-plus-`exit(0)` nur im Worker. Ein Parameter, kein Umbau.

### 15. Der einzige erreichbare Zweig von `killProcessTree` ist der, den seine Dokumentation verbietet

**Unverändert** (`lib/workspace.ts:143-153`). Auf Linux erzeugt `detached: true` die Gruppe immer; solange das Kind lebt, kann `kill(-pid, …)` nicht mit ESRCH scheitern. Der Rückfall auf die nackte PID ist damit nur bei leerer Gruppe erreichbar — also genau dann, wenn der Anführer schon abgeräumt ist, was der Doc-Kommentar ausschließt. Operativ praktisch harmlos (`/proc/sys/kernel/pid_max` = 4194304), aber eine dokumentierte Vorbedingung, die kein Produktionsaufrufer erfüllen kann.

### 16. Nach `settle` bleiben die Ausgabe-Listener hängen

**Unverändert.** `settle` (`lib/workspace.ts:260-271`) löscht die Timer, schießt die Gruppe ab und resolved — nimmt aber die `data`-Listener auf `child.stdout`/`child.stderr` (`:298-307`) nicht ab. Ein Enkel, der selbst `setsid()` gerufen hat und die geerbte Pipe hält, lässt danach weiter `stdout += s` und `emit(s)` laufen: ein Speicherleck in einer Closure, die niemand ausliest, und `opts.onData` für einen längst beantworteten Aufruf — Ausgabe eines fertigen Schritts landet unter dem nächsten. Fix bleibt `if (settled) return;` als erste Zeile von `emit` (`:288`).

### 17. Der Pfad, der die beobachteten Waisen erzeugt hat, bleibt ungedeckt

**Unverändert.** `grep -c mem_limit docker-compose.yml` → weiterhin **0**, für jeden Container. `installProcessTreeCleanup` deckt `exit`, SIGTERM, SIGINT, SIGHUP (`lib/workspace.ts:177`, `203-213`), nicht SIGKILL — und der OOM-Killer schickt ausschließlich SIGKILL. Der häufige Pfad ist geschlossen; der im Schadensfall von bug-023 gelaufene (Worker unter Speicherdruck hart abgeschossen) nicht. Das Verbot eines Speicherlimits im Bugreport galt gegen ein `mem_limit` **als Ersatz** für die Ursachenbehebung; die Ursache ist seit `046b076` behoben, der Grund ist entfallen, das Folge-Requirement in `ready/` gibt es weiterhin nicht (`delivery/requirements/ready/` ist leer).

### 18. bug-022: Eine vom Menschen gesetzte Pause wird weiterhin überschrieben

**Unverändert**, an den heutigen Zeilen nachgeprüft. `lib/worker-loop.ts:412` schreibt weiterhin bedingungslos `setPauseUntil(new Date(untilMs).toISOString())`, sobald ein Pass nichts geschafft hat, ohne zu lesen, was gespeichert ist; `runOnce` liest `pause_until` weiterhin nicht. Der Test `worker-loop.test.ts:591` heißt weiterhin „eine vom Menschen gesetzte Pause überschreibt der Worker nicht" und prüft weiterhin nur, dass nie `null` geschrieben wurde — das Überschreiben sammelt er ein und schaut daran vorbei.

Das ist dasselbe Muster wie bei Befund 1: ein Test, dessen Name eine Absicherung behauptet, die sein Rumpf nicht prüft. Zwei davon in einem Repo sind kein Zufall, sondern ein Hinweis, worauf eine Testdurchsicht achten sollte.

### 19. `lib/acceptance-criteria.ts` ist weiterhin toter Code

**Unverändert.** `grep -rn "acceptance-criteria"` über alle `.ts`/`.tsx` → **genau ein Treffer**, die eigene Testdatei. 102 Zeilen, sechs exportierte Funktionen, 14 Tests, die in diesem Lauf grün liefen — über Code, der in der Produktion nie aufgerufen wird. Bei Befund 11 im Kopf ist das doppelt bitter: Das eine Modul, das Akzeptanzkriterien auswerten könnte, ist genau das, das niemand ruft.

### 20. Beim Timeout wandert die `.md` weiterhin nach `failed/` — AC 4 von req-036 bleibt unerfüllt

**Unverändert.** `lib/network-abort.ts:70` schließt den Timeout weiterhin ausdrücklich aus (`if (!text || isClaudeTimeout(text)) return false`), also fällt er in den gewöhnlichen Fehlerzweig: `keepStages`, dann `parkFailed`. Ergebnis unverändert: halbfertige Arbeit auf `dev`, Paket in `failed/`, kein Durchlauf nimmt es wieder auf.

### 21. `parkFailed` pusht weiterhin fremde Commits

**Unverändert.** `lib/execute-step.ts:816` ruft weiterhin `discardChanges` (das Commits stehenlässt) und danach `commitAndPush` (das alle lokalen Commits mitschiebt), während der Kommentar darüber verspricht, der Commit trage nur den Move. Der unangenehmste Weg bleibt das rote Test-Gate: `parkFailed` ohne vorheriges `keepStages` — der Zweig, der einen roten Stand nicht durchlassen soll, pusht ihn.

### 22. Der `health-agent` vertraut seinem Netz weiterhin vollständig

**Unverändert.** `grep -c "TOKEN\|timingSafeEqual\|authoriz\|secret" agent/index.ts agent/routes.ts` → **0 und 0**. Jeder Prozess im Compose-Netz kann weiterhin `GET /containers/<id>/env?name=…`, `POST /containers/<id>/restart` und `GET /containers/<id>/logs`.

### 23. `psql` in der Erlaubnisliste ist weiterhin faktisch beliebige Befehlsausführung

**Unverändert.** `lib/docker.ts:35`: `ALLOWED_EXEC_COMMANDS = ["pg_isready", "psql"]`, und `isAllowedCommand` prüft weiterhin ausschließlich `cmd[0]`. `psql -c '\! …'` und `COPY … FROM PROGRAM …` bleiben erreichbar. Der Kommentar darüber behauptet weiterhin, alles andere wäre „beliebige Befehlsausführung als root" — als sei `psql` das nicht.

### 24. Die Web-Prüfung wertet „konnte nicht geprüft werden" weiterhin als Rot

**Unverändert.** `lib/health-checks.ts:197-199`: jeder Fehler aus `fetchImpl` setzt `failed = true`, und der Text sagt „keine Antwort". Nach zwei Runden meldet Telegram — pro überwachter App, mitten in der Nacht, über Apps, denen nichts fehlt.

### 25. Geheimnisse sollen laut Doku nach `deploy/*.env` — einen Pfad, den der Deploy nie liest

**Unverändert.** `delivery/devops.md` weist weiterhin an vier Stellen (24, 54, 80, 117) auf `deploy/dev.env` / `deploy/prod.env`; `.github/workflows/deploy.yml:50,53` liest ausschließlich `$HOME/appbaua-env/{dev,prod}.env`. Der Kopf der `docker-compose.yml` (Zeilen 4–5) nennt weiterhin den toten Pfad, während Zeile 106 derselben Datei schon `~/appbaua-env/*.env` sagt. `grep -c deploy .gitignore` → **0**: Wer der Anleitung folgt, legt Geheimnisse in einem nicht ignorierten Verzeichnis ab und bekommt keine Fehlermeldung, sondern Stille.

Dazu passend, mit Blick auf den heute gelesenen Auth-Stack: `APP_ORIGIN` gehört laut `devops.md:24` in genau diese toten Dateien — und `APP_ORIGIN` ist die einzige Quelle für `rpId`/`expectedOrigin` (`lib/webauthn-config.ts`). Fehlt die Variable, fällt die App stillschweigend auf `http://localhost:3000` zurück, und **jede** Passkey-Verifikation scheitert an `expectedOrigin`, ohne dass irgendwo ein Konfigurationsfehler gemeldet wird.

### 26. Der PHP-Ausfallwächter wird weiterhin faktisch ungetestet ausgeliefert

**Unverändert, live bestätigt:** `watchdog/watchdog.test.ts (14 tests | 9 skipped)` in diesem Lauf. Token-Prüfung, Alarm nach Frist, genau eine Nachricht, Entwarnung — nichts davon läuft in einem nachweisbaren Lauf.

### 27. Weitere Vorbefunde, am heutigen Code nachgeprüft und unverändert offen

- **Container laufen in UTC.** `grep -c TZ` → **0** in `docker-compose.yml`, `Dockerfile`, `Dockerfile.worker`, `Dockerfile.agent`. Zeitfenster der Task-Typen bleiben 1–2 h gegen deutsche Ortszeit verschoben.
- **`WATCHDOG_TOKEN` fehlt weiterhin in `SECRET_ENV_VARS`** (`grep -c WATCHDOG_TOKEN lib/redact.ts` → 0).
- **„Heute schon gelaufen" hängt weiterhin an einem 500-Zeilen-Fenster** (`lib/worker-loop.ts`).
- **`NODE_ENV=production` leckt weiterhin in Claudes Kindprozesse** (`env: { ...process.env, ...opts.env }`, `lib/workspace.ts:225`); `lib/test-gate.ts` macht es für das offizielle Gate richtig. Heute mitgeprüft: `NODE_ENV=production` steht in `Dockerfile:22`, `Dockerfile.worker:6` und an drei Stellen der `docker-compose.yml` (71, 141, 179).
- **Lost-Update-Race in allen Blob-Mutationen** — `repo-service`, `task-service`, die Health-Blobs, `createPgNetworkAbortStore`. **Neu dazu:** der File-Auth-Store (`lib/auth-store.ts:75-197`) hat dasselbe Muster an **jeder** seiner 19 Methoden — `readAll()`, mutieren, `writeAll()`, ohne Sperre. Zwei gleichzeitige Anmeldungen können sich die Sitzungszeile des anderen überschreiben.
- **Auth-Bootstrap: TOCTOU**, `countUsers()`/`createUser()` weiterhin nicht transaktional — und seit Befund 2 ist klar, dass dieselbe Stelle noch ein zweites, schwereres Problem hat.
- **`diagnostics` bleibt eine Spalte ohne Produzenten**; `delivery/requirements/ready/` enthält weiterhin kein Folge-Requirement für die offenen Kriterien aus req-036/037.
- **bug-021: `overflowX: "clip"` weiterhin ohne Umbruchregel in `TaskControl.tsx`**; die kaputte Einrückung in vier Komponenten ebenso.
- **`serviceBlockLocal` in `docker-compose.test.ts:152` weiterhin ungenutzt**; das `worker-work`-Volume wächst weiterhin unbegrenzt; der Netzabbruch-Zähler wird weiterhin nie aufgeräumt.
- **`next lint` ist deprecated** — die Warnung stand auch in diesem Lauf wieder im Log.

---

## Kleinere Punkte

**Neu, aus dem Auth-Stack:**

- **`newCode()` stimmt an drei Stellen nicht mit seinem Kommentar überein** (`lib/auth-recovery.ts:12-16`). Der Kommentar sagt „10 random bytes -> 16 base32 chars, split for readability: XXXX-XXXX-XXXX-XXXX"; der Code macht `randomBytes(10).toString("hex")` — also **hex**, nicht base32, **20** Zeichen, nicht 16, und damit **fünf** Gruppen, nicht vier. Die Entropie ist in Ordnung (10 echte Zufallsbytes = 80 Bit), nur die Beschreibung nicht. Wer das Format aus dem Kommentar in ein Eingabefeld oder eine Validierung überträgt, baut eine Prüfung, die jeden echten Code ablehnt.
- **`getOperator()` ist toter Code in der Produktion.** In der Schnittstelle deklariert (`lib/auth-store.ts:23`) und in beiden Stores plus Postgres implementiert (`lib/pg-store.ts:675`) — gerufen wird es nur aus Tests. Für ein Modul, dessen Kommentar „es gibt kein Rollensystem" betont, ist die eine Abfrage nach dem Betreiber die, die man erwarten würde; stattdessen fragt jede Stelle `user?.isOperator` am durchgereichten Objekt.
- **`issueBackupCodes` kann kollidierende IDs erzeugen** (`lib/auth-recovery.ts:36`): `id: ${userId}-${now().getTime()}-${i}`. Zwei Aufrufe für denselben Nutzer in derselben Millisekunde geben zehn identische ID-Paare. `clearBackupCodesForUser` läuft vorher, deshalb ist es heute folgenlos — aber `consumeBackupCode(id)` arbeitet mit `find`, entwertet also bei einer Dopplung nur die erste Zeile. Ein `randomBytes`-Suffix statt der Millisekunde kostet nichts.
- **`rpId()` wirft bei fehlkonfiguriertem `APP_ORIGIN`** (`lib/webauthn-config.ts:22`): `new URL(appOrigin(env)).hostname` ohne `try`. Ein `APP_ORIGIN=dev.appbaua.com` ohne Schema — der naheliegende Tippfehler — lässt nicht die Anmeldung fehlschlagen, sondern wirft beim ersten Aufruf jeder Zeremonie einen `TypeError: Invalid URL` in einen Route-Handler. Eine Prüfung beim Hochfahren wäre der Ort, an dem das jemandem auffällt, und `instrumentation.ts` ist dafür schon da.
- **Die Fehlermeldungen von `redeemInvitation` unterscheiden, was der Kommentar nicht unterscheiden will.** `lib/auth-invitation.ts:39-44` schreibt „Every rejection path (unknown token, expired, already used) returns the same shape as an ordinary failure — no distinction that would let someone probe for valid-but-expired tokens." Der Code gibt aber drei verschiedene Werte zurück (`"invalid" | "expired" | "already-used"`, Zeilen 51-55), und `app/api/auth/invitations/[token]/start/route.ts:13` reicht sie unverändert als `error` im JSON nach außen. „Same shape" trifft auf den TypeScript-Typ zu, nicht auf den Informationsgehalt: Ein Fremder kann gültige Tokens von unbekannten unterscheiden. Bei 128 Bit Token-Entropie ist das nicht ausnutzbar — aber der Kommentar behauptet eine Eigenschaft, die der Code daneben widerlegt, und das ist dasselbe Muster wie in den Befunden 15, 18 und 23.
- **`secure` am Sitzungs-Cookie hängt an `NODE_ENV`** (`lib/auth-cookie-name.ts:13`), nicht am Origin. Heute trägt es, weil `NODE_ENV=production` in allen Images und Compose-Diensten gesetzt ist (nachgeprüft, siehe Befund 27) — aber genau diese Kopplung ist die, die bug-015 schon einmal an anderer Stelle schmerzhaft gemacht hat. `appOrigin().startsWith("https:")` wäre die Bedingung, die die Sache tatsächlich meint.

**Aus früheren Reviews, unverändert:**

- `killAllProcessTrees` räumt `liveGroups` nicht leer (`lib/workspace.ts:161-168`); Exit-Code 0 auf SIGTERM statt 143 (`:211`); der bug-023-Prüfstand kann bei rotem Lauf selbst eine Waise hinterlassen (`workspace-process-tree.test.ts:87-93`); seine Wanduhr-Fristen (300 ms Timeout) bleiben auf dem Beelink knapp; `opts.killGraceMs` hat außerhalb der Tests keinen Aufrufer.
- Eine 6-Stunden-Pause kostet weiterhin ~1.080 Weckvorgänge mit je zwei Store-Abfragen; der Hauptschalter als Weckruf hilft bei einem Rate-Limit nicht; ein dauerhaft ausfallender Store blendet den Hauptschalter mit aus (`catch { continue }`); die 20-Sekunden-Lücke der Anzeige bleibt.
- `RunLog.tsx` `load()` weiterhin ohne Fehlerbehandlung — bei einem Fehlschlag bleibt `loading` auf `true`. `HealthOverview.tsx` macht es an derselben Stelle richtig.
- `runRound` listet die Container weiterhin je Repo statt je Runde; der Kommentar sagt „Einmal auflisten".
- `/neustart`-Rückfrage verfällt nie; Entwarnung ohne vorherige Meldung; Prompt-Injection aus fremden Logs; `flock` fehlt im PHP-Wächter; `check.php` trägt die Kennung als URL-Cronjob in die Zugriffslogs.
- Kommentare zum `health-agent` („genau vier Aufrufe", „kein Netzwerk nach außen") weiterhin unzutreffend.
- pg-store-Retention bei jedem Insert; File-Store vergibt Log-IDs nach `clear()` neu; `sampleCache` racy; Memory-Repo-Store-Backfill nur beim Anlegen.
- `delivery/health.md:46` sagt weiterhin „bis zu einer Stunde je Paket"; seit `ac2c9b6` sind es zwei.

---

## Was gut ist

Der Auth-Stack ist nicht nachlässig gebaut, und das ist beim Lesen wichtig geworden: Die zwei kritischen Befunde sind keine Symptome von Schlamperei, sondern beides Fehler an einer Naht zwischen zwei Modulen, die jedes für sich sorgfältig ist.

**Die Trennung ist durchdacht, und zwar aus echten Gründen.** `lib/auth-cookie-name.ts` existiert, weil `middleware.ts` in der Edge-Runtime läuft und nichts importieren darf, was `node:crypto`/`fs` nachzieht — das steht im Kopf der Datei, mit der Begründung, und `lib/browser-imports.test.ts` wacht darüber. `lib/auth-cookie.ts` ist die eine Stelle, die `next/headers` anfasst, damit `auth-session.ts` frameworkfrei und unit-testbar bleibt. `instrumentation.ts` setzt den Import absichtlich **in** den positiven Zweig statt hinter ein `return`, damit der Bundler den ganzen Block aus dem Edge-Bündel wirft — mit vier Zeilen Erklärung, warum. Das sind drei Entscheidungen, die man ohne Kommentar für Zufall halten würde und beim nächsten Aufräumen kaputtmachen.

**Die Challenge liegt serverseitig, und der Grund dafür ist der richtige.** `lib/auth-webauthn.ts:21-24`: „Storing the challenge in the DB rather than a cookie/session means the ceremony survives landing on a different server process between the two calls, which a stateless Next.js deployment does not guarantee against." Das ist der Fehler, den die meisten WebAuthn-Integrationen machen, und hier ist er vorweg vermieden. Dass `consumeChallenge` lesen und löschen in **einer Transaktion** macht (`lib/pg-store.ts:756-776`, mit `BEGIN`/`COMMIT`/`ROLLBACK` und `client.release()` im `finally`) ist die Einmaligkeit, die eine Challenge braucht — und sie ist sauber umgesetzt, während die Nachbarmethoden dieses Stores sie nicht brauchen und deshalb auch nicht haben.

**Die kleinen Dinge sind richtig.** Das Cookie trägt nur eine opake Sitzungs-ID, jede andere Tatsache liegt serverseitig — mit der ausgeschriebenen Begründung, dass ein Logout dann eine Zeile löscht statt ein signiertes Token zu invalidieren. `randomBytes(32)` für Sitzungen, `randomBytes(16)` für Tokens, `randomBytes(10)` für Codes — alles CSPRNG, nirgends `Math.random`. `userIdForSession` prüft **neben** der Existenz auch `expiresAt`. Die Entscheidung, Backup-Codes mit SHA-256 statt scrypt zu hashen, ist im Kommentar begründet und **korrekt**: 80 Bit echte Entropie brauchen keine künstliche Langsamkeit, das ist keine Abkürzung, sondern das richtige Werkzeug. `backupCodeStatus` behält verbrauchte Codes als Zeile mit `codeHash: null`, damit „wie viele sind übrig" ohne zweiten Zähler beantwortbar bleibt — eine Entscheidung mit Begründung im Typ (`lib/auth-types.ts:52-53`). Und `app/api/auth/backup-codes/route.ts` nimmt die Nutzer-ID ausschließlich aus `currentUser()`, mit dem Kommentar, dass nicht einmal der Betreiber auf fremde Codes wirken darf — das ist genau die Stelle, an der ein `?userId=` in neun von zehn Codebasen steht.

**Die Oberfläche ist an einer Stelle bewusst vorsichtig.** `app/login/page.tsx:27` — `setBootstrapped(true)` im `catch`, mit dem Kommentar „fail closed: no link shown on doubt". Die Richtung ist richtig gewählt. (Dass genau diese Vorsicht in Befund 2 zum Problem wird, liegt nicht an ihr, sondern daran, dass `bootstrap/status` die falsche Frage beantwortet.)

Im Übrigen unverändert solide: `pushFailed()` wird konsequent geprüft, `runTestGate` läuft vor jedem Move nach `done/`, SQL ist überall parametrisiert — auch im Auth-Store, in allen 19 Methoden —, `GIT_TERMINAL_PROMPT: "0"` und die Übergabe des Tokens als Einweg-Config statt in der URL (`lib/workspace.ts:408-413`) sind weiterhin richtig gemacht, und die Trennung reine Logik ↔ Naht nach draußen trägt 1179 Tests ohne Docker, ohne Telegram und ohne KI-Anbieter in 20 Sekunden.

---

**Empfehlung:**

**Befund 1 zuerst, und zwar vor allem anderen.** Es ist eine Zeile — die verifizierte Credential-ID aus `finishRegistration` zurückgeben und in `finishRegistrationAndSignIn` benutzen statt `response.id` —, und solange sie so steht, entscheidet ein Feld aus dem Request-Body, als wer eine Sitzung ausgestellt wird. Dass heute noch die Unkenntnis einer Credential-ID davorsteht, ist Glück und keine Absicherung; Credential-IDs sind im WebAuthn-Modell öffentliche Bezeichner. Der Repro-Test ist der, den ich gefahren habe, und er fehlt in `auth-webauthn.test.ts` genau deshalb, weil dort `response.id` und `credential.id` per Konstruktion gleich sind — der Test für diesen Fix muss sie ungleich setzen.

**Dann Befund 2.** Auch klein (`countUsers()` → „hat schon jemand ein Credential", an beiden Stellen: `bootstrapOperator` und `bootstrap/status`), aber der Schaden ist der härteste von allen: eine Umgebung, in die niemand mehr hineinkommt, ausgelöst durch einen abgebrochenen Face-ID-Dialog oder einen einzigen fremden POST aus dem Internet. Wer heute prod neu aufsetzt, läuft genau durch dieses Fenster. Zusammen mit Befund 6 (Code erst nach der Zeremonie verbrennen) sind das die drei Lockout-Pfade dieses Repos, und alle drei enden im selben Zustand: App erreichbar, Anmeldung unmöglich, Ausweg nur über die Datenbank.

**Dann Befund 10** — `npm audit fix` plus `images: { unoptimized: true }`, zusammen eine Viertelstunde. Diese Viertelstunde steht seit drei Berichten im Rezept, und die Liste ist in der Woche ohne jede Code-Änderung um einen High-Befund gewachsen. Das ist der billigste Posten hier und der einzige, der von allein schlechter wird.

**Dann Befund 3** — neuntes Review, 3 von 33 Routen, und dahinter weiterhin ein Neustart-Knopf für fremde prod-Container, der niemanden nach seinem Namen fragt. Mit Befund 1 daneben liest sich das anders als in den acht Berichten davor: Der Weg zu einem echten Cookie ist kürzer als angenommen, und danach fragt in 30 von 33 Routen niemand mehr nach.

**Befund 5** bleibt der billigste echte Gewinn im Worker-Teil (`isNecessaryNetworkAbort` auf `errorKindOf(text) === "network"` zurückführen), **Befund 17** bleibt das Folge-Requirement, das seit zwei Berichten in `ready/` gehört und dessen Verbotsgrund mit `046b076` entfallen ist, und **Befund 7/8** (Aufräumen beim Lesen, ein Zähler pro IP über `/api/auth`) schließen zusammen den unauthentifizierten Teil des Auth-Stacks.

Zu **Befund 11** ein Wort über die Reihenfolge hinaus: 7 von 246 Kriterien abgehakt, 37 von 38 Dateien in `done/` ohne ein einziges Häkchen. Die beiden kritischen Befunde dieses Berichts sitzen in req-023 — einer Datei in `done/`, deren Kriterien alle offen sind, und eines dieser offenen Kriterien beschreibt wörtlich den Vorgang, der in Befund 2 die Installation zusperrt. Ich halte das nicht für Buchhaltung. Das Häkchen ist der einzige Ort im Prozess, an dem „gebaut" von „durchgespielt" getrennt wird, und beide Befunde hätte ein ernst genommenes Durchspielen gefunden — Befund 2 beim ersten abgebrochenen Face-ID-Dialog.

**Zusammenfassung:** Ein Durchgang **ohne jede Code-Änderung** — zwei Commits, beide Markdown. Alle zwanzig Vorbefunde habe ich einzeln am heutigen Code nachgeprüft; **alle zwanzig sind unverändert offen**, darunter neunmal in Folge die fehlende Authentifizierung (heute gezählt: 3 von 33 Routen) und eine kritische RCE-Bewertung, deren Entschärfung seit drei Wochen als Zwei-Schritte-Rezept vorliegt. Die Zeit ohne Diff ist in den einen Teil des Codes gegangen, den zehn Review-Berichte nie angesehen haben: `lib/auth-*.ts` kommt in `delivery/reviews/*.md` null mal vor. Dort stehen zwei neue kritische Befunde, beide mit einem Prüfstand belegt, der grün lief und wieder gelöscht ist. **Erstens** meldet `finishRegistrationAndSignIn` anhand von `response.id` an — einem ungeprüften Feld aus dem Request-Body — statt anhand der ID, die `finishRegistration` gerade verifiziert hat; die Bibliothek gleicht `response.id` nirgends gegen die Attestation ab (nachgelesen: sie prüft nur `id === rawId`), und mein Prüfstand meldet einen eingeladenen Nicht-Betreiber-Nutzer als Betreiber an. **Zweitens** sperrt ein einziger unauthentifizierter `POST /api/auth/bootstrap/start` — öffentlich über den `/api/auth`-Präfix der Middleware, über Cloudflare aus dem Internet erreichbar — die Installation dauerhaft zu: Nutzer angelegt, kein Passkey, kein Backup-Code, keine Sitzung, Ersteinrichtung endgültig geschlossen, und die Oberfläche blendet den einzigen Link, der noch helfen könnte, genau dann aus. Dazu sieben weitere neue Befunde aus demselben Stack: ein Backup-Code wird verbrannt, bevor die Zeremonie gelaufen ist; Challenges und Sitzungen werden nie aufgeräumt, obwohl ihr Erzeuger unauthentifiziert ist; kein Rate-Limit auf irgendeiner Auth-Route; ein Sitzungs-Cookie ohne Lebensdauer gegen 30 Tage serverseitig; und 7 von 246 Akzeptanzkriterien in `done/` abgehakt — in einem Repo, dessen Testpolicy ohne Test für das Verhalten nichts als fertig gelten lässt. Quality Gate live und vollständig grün: 1179/1179 Tests (+9 übersprungen, 76 Dateien), Typecheck sauber, Lint unverändert 5 False Positives; `npm audit` **1 kritisch + 4 high (total 5, einer mehr als letzte Woche)** durch den neuen High-Befund in `source-map-js`. Ich habe nichts committet und nichts gepusht; der Arbeitsbaum ist sauber.
