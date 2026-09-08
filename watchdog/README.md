# Ausfallwächter beim Webhoster (req-034)

Dieser Ordner wird **nicht** mit deployt. Er enthält die Dateien, die von
Hand einmal auf den Webspace bei all-inkl gelegt werden.

## Warum er woanders läuft

Zustandsübersicht (req-032) und Telegram-Meldungen (req-033) laufen auf
demselben Rechner wie die überwachten Apps. Fällt dieser Rechner selbst
aus — Strom, Internet, appbaua tot —, fällt der Wächter mit ihm weg und
niemand erfährt davon. Der Ausfallwächter steht deshalb bewusst außerhalb:
appbaua meldet sich alle paar Minuten bei ihm, und wenn diese Meldung
länger als 15 Minuten ausbleibt, schickt **er** die Telegram-Nachricht.

Er weiß nichts über die überwachten Apps, prüft nichts selbst und kann
nichts steuern. Er beantwortet genau eine Frage: lebt der Rechner noch?

Fällt der Hoster selbst aus, gibt es keine Meldung. Dieser Fall bleibt
offen — ein zweiter Wächter, der den Wächter überwacht, ist ausdrücklich
nicht Teil von req-034.

## Ablage beim Hoster

```
/www/htdocs/wXXXXXXX/                 <- Konto-Wurzel, NICHT öffentlich
├── watchdog-private/                 <- Inhalt von private/
│   ├── watchdog.php
│   ├── config.php                    <- aus config.sample.php, mit den Geheimnissen
│   └── state.json                    <- legt der Wächter selbst an
└── deine-domain.de/                  <- Web-Verzeichnis, öffentlich
    └── watchdog/                     <- Inhalt von public/
        ├── heartbeat.php
        └── check.php
```

Entscheidend ist, dass `watchdog-private/` **nicht** unterhalb des
Web-Verzeichnisses liegt. Bot-Schlüssel, Chat-Kennung und die Kennung des
Herzschlags stehen dort im Klartext; im öffentlichen Bereich wären sie bei
einer falsch konfigurierten PHP-Version über den Browser lesbar.

Weicht deine Ablage von diesem Bild ab, passt du in `heartbeat.php` und
`check.php` je die eine Zeile mit dem Pfad an (sie ist dort markiert).

## Einrichten — einmalig, von Hand

1. **Dateien hochladen** wie oben, per FTP oder SFTP.
2. **Kennung erzeugen:** etwas Langes, Zufälliges, z.B.
   `openssl rand -hex 32`.
3. **`config.php` anlegen:** `config.sample.php` nach `config.php` kopieren
   und `bot_token`, `chat_id` und `token` eintragen. Bot-Schlüssel und
   Chat-Kennung sind dieselben wie in `deploy/<env>.env` (req-033).
4. **appbaua die Adresse geben:** in `deploy/dev.env` bzw.
   `deploy/prod.env` eintragen und die Umgebung neu deployen:

   ```
   WATCHDOG_URL=https://deine-domain.de/watchdog/heartbeat.php
   WATCHDOG_TOKEN=<dieselbe Kennung wie in der config.php>
   # optional, Voreinstellung 5, erlaubt sind 1–10:
   WATCHDOG_INTERVAL_MINUTES=5
   ```

5. **Cronjob im Kundenmenü anlegen** (KAS → Tools → Cronjobs), alle 5
   Minuten. Ohne ihn merkt niemand, dass der Herzschlag ausblieb — der
   Hoster bietet keine Hintergrunddienste, dieser Anstoß muss von dort
   kommen.

   Als URL-Cronjob (die Kennung muss mit, sonst wird abgewiesen):

   ```
   https://deine-domain.de/watchdog/check.php?token=<Kennung>
   ```

   Oder als Skript-Cronjob, dann ohne Kennung:

   ```
   /usr/bin/php /www/htdocs/wXXXXXXX/deine-domain.de/watchdog/check.php
   ```

6. **Prüfen:** In appbaua auf der Zustandsseite steht oben „Herzschlag
   angenommen HH:MM". Steht dort eine Fehlermeldung, sagt sie, woran es
   lag; der Versuch steht zusätzlich im Verlauf.

**Je Umgebung ein eigener Wächter.** dev und prod bekommen je ein eigenes
Verzeichnis mit eigener `config.php` (eigene Kennung, eigenes `label`) —
sonst hielte ein laufendes dev den prod-Rechner für lebendig.

## Was wann verschickt wird

| Lage | Nachricht |
|------|-----------|
| Herzschlag kommt regelmäßig | keine |
| Herzschlag bleibt < 15 Min aus (z.B. Deploy-Neustart) | keine |
| Herzschlag bleibt > 15 Min aus | **eine** Meldung „Rechner meldet sich nicht" |
| Ausfall dauert an | keine weitere |
| Herzschlag kommt wieder | eine Entwarnung mit der Dauer des Ausfalls |
| Aufruf ohne gültige Kennung | keine — HTTP 403, und der Aufruf zählt nicht als Herzschlag |

Scheitert der Versand einer Nachricht, bleibt der gemerkte Zustand so, dass
der nächste Aufruf es erneut versucht. Ein nicht erreichbares Telegram
verschluckt also keinen Ausfall.

## Tests

`watchdog.test.ts` fährt `heartbeat.php` und `check.php` mit einem echten
PHP gegen einen vorgetäuschten Telegram-Server. Ist auf dem Rechner kein
`php` installiert, überspringt Vitest diese Fälle und prüft nur, was sich
ohne PHP prüfen lässt (die Ablage der Geheimnisse, die 15-Minuten-Frist).
