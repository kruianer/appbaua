# SSH-Zugang zum Beelink über Cloudflare — Schritt für Schritt

Danach erreichst du (und der Assistent) den Beelink von überall per
`ssh beelink`, unabhängig vom WLAN, ohne offenen Port am Router. Genau
so, wie die vier Web-Tunnel es heute schon für die Apps tun.

**Zeitbedarf:** etwa 20 Minuten.

**Was du brauchst:**

- Zugang zum Cloudflare-Konto (dasselbe wie für die App-Tunnel)
- Zugang zum Beelink — per SSH, solange das LAN läuft, sonst mit
  Monitor und Tastatur
- Das `sudo`-Passwort des Beelink

---

## Teil A — Auf dem Beelink

### A1. Einloggen

Solange das LAN läuft, von deinem PC aus:

```
ssh kruianer@192.168.2.200
```

Wenn nicht: Monitor und Tastatur ans Gerät, dort anmelden.

### A2. Prüfen, was schon da ist

```
cloudflared --version
ls ~/.cloudflared/
```

Erwartet: eine Version (2026.6.0 oder neuer) und mindestens eine
`cert.pem`. Beides ist vorhanden — dein Konto ist bereits verbunden, wir
bauen nur einen Tunnel dazu.

Falls `cloudflared` fehlt, sag Bescheid; dann kommt ein Schritt davor.

### A3. Den Tunnel anlegen

```
cloudflared tunnel create beelink-ssh
```

Die Ausgabe nennt eine **Tunnel-ID** (eine lange Zeichenfolge mit
Bindestrichen). Notiere sie — du brauchst sie in A4 und B2.

Beispiel:

```
Created tunnel beelink-ssh with id a1b2c3d4-e5f6-...
```

### A4. Die Konfiguration schreiben

```
nano ~/.cloudflared/config.yml
```

Trage ein — **die Tunnel-ID aus A3 an beiden Stellen einsetzen**:

```yaml
tunnel: DEINE-TUNNEL-ID
credentials-file: /home/kruianer/.cloudflared/DEINE-TUNNEL-ID.json

ingress:
  - hostname: ssh.appbaua.com
    service: ssh://localhost:22
  - service: http_status:404
```

Speichern: `Strg+O`, `Enter`, dann `Strg+X`.

Zwei Dinge, die hier wichtig sind:

- `localhost:22` — der Tunnel spricht den SSH-Dienst auf derselben
  Maschine an. Nichts wird nach außen geöffnet.
- Die letzte Zeile (`http_status:404`) muss stehenbleiben. Sie weist
  alles ab, was nicht zum Hostnamen passt.

### A5. Den Hostnamen bei Cloudflare eintragen

```
cloudflared tunnel route dns beelink-ssh ssh.appbaua.com
```

**Hier kann ein Konflikt auftreten.** Nachgeprüft am 08.09.: In deiner
Zone lösen ALLE Unterdomänen auf — `ssh.`, `beelink.`, `shell.` gleich
mehrfach. Es gibt dort offenbar einen Platzhalter-Eintrag (`*`), der
jeden Namen beantwortet. Einen "freien" Namen zu suchen bringt deshalb
nichts.

Meldet der Befehl oben einen Konflikt, überschreibe den Eintrag:

```
cloudflared tunnel route dns --overwrite-dns beelink-ssh ssh.appbaua.com
```

Das ist unbedenklich: Es ändert nur, wohin `ssh.appbaua.com` zeigt.
Andere Namen — und damit deine Apps — bleiben unberührt.

Willst du vorher sehen, was dort heute steht: im Cloudflare-Dashboard
unter **DNS → Records** nach `ssh` suchen.

### A6. Als Dienst einrichten

```
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

Der Tunnel startet damit automatisch mit der Maschine — genau wie die
App-Tunnel.

### A7. Prüfen, dass er läuft

```
systemctl status cloudflared --no-pager | head -12
```

Erwartet: `active (running)` und in den Zeilen darunter mehrere
`Registered tunnel connection`.

**Wichtig:** Der Tunnel steht jetzt, ist aber noch **ungeschützt**. Bis
Teil B fertig ist, könnte jeder, der den Hostnamen kennt, den
SSH-Anmeldebildschirm erreichen. Der Schlüssel schützt weiterhin, aber
mach Teil B zügig.

---

## Teil B — Im Cloudflare-Konto (Browser)

### B1. Zero Trust öffnen

<https://one.dash.cloudflare.com> → dein Konto wählen.

### B2. Access-Anwendung anlegen

Links im Menü: **Access → Applications → Add an application**

- Typ: **Self-hosted**
- Application name: `Beelink SSH`
- Session Duration: **24 hours**
- Public hostname:
  - Subdomain: `ssh` (bzw. `beelink`, falls du in A5 ausgewichen bist)
  - Domain: `appbaua.com`
  - Path: leer lassen

Weiter zu den Regeln.

### B3. Die Regel — das ist der eigentliche Schutz

- Policy name: `Nur Betreiber`
- Action: **Allow**
- Include: **Emails** → `uwe@kremmel.org`

Speichern.

**Ohne diese Regel ist der SSH-Dienst der Maschine öffentlich
erreichbar.** Sie ist kein Beiwerk, sondern der Grund, warum der Tunnel
verantwortbar ist.

Binde die Regel an die **E-Mail**, nicht an eine IP oder ein Land —
sonst kommst du unterwegs nicht durch, und genau dafür ist der Aufbau
gedacht.

---

## Teil C — Auf deinem Windows-PC

### C1. cloudflared

Ist bereits installiert (Version 2026.8.3). Zur Kontrolle:

```
cloudflared --version
```

### C2. Die SSH-Konfiguration ergänzen

Datei öffnen (in PowerShell):

```
notepad $env:USERPROFILE\.ssh\config
```

Ans Ende anfügen:

```
Host beelink
    HostName ssh.appbaua.com
    User kruianer
    IdentityFile ~/.ssh/appbaua_beelink
    IdentitiesOnly yes
    ProxyCommand cloudflared access ssh --hostname %h
```

Speichern und schließen.

Der bestehende Eintrag `beelink-appbaua` mit der lokalen IP kann
danebenstehen bleiben — er ist im eigenen WLAN einen Sekundenbruchteil
schneller. Der neue Eintrag `beelink` funktioniert überall.

### C3. Zum ersten Mal verbinden

```
ssh beelink
```

Beim ersten Mal öffnet sich der Browser. Melde dich mit
`uwe@kremmel.org` an; Cloudflare schickt einen Einmal-Code. Danach gilt
die Sitzung **24 Stunden**.

Erwartet: die Eingabeaufforderung des Beelink.

---

## Danach

**Was sich ändert:** Der Beelink ist über `ssh beelink` erreichbar — aus
deinem WLAN, aus dem Hotel, aus dem Zug. Auch dann, wenn das lokale Netz
wieder ausfällt.

**Was gleich bleibt:** Dein SSH-Schlüssel wird weiterhin gebraucht.
Cloudflare Access entscheidet, WER den Tunnel benutzen darf; SSH
entscheidet, wer sich anmelden darf. Beides zusammen.

**Für den Assistenten:** Er nutzt deine Sitzung, bekommt keinen eigenen
Zugang und sieht deine Zugangsdaten nie. Läuft die 24-Stunden-Sitzung
ab, verlangt der nächste Befehl eine Bestätigung im Browser — die kannst
nur du geben.

## Wenn etwas nicht klappt

| Meldung | Bedeutung |
|---|---|
| `websocket: bad handshake` | Am Hostnamen hängt kein SSH-Tunnel — A4/A5 prüfen |
| Browser öffnet sich nicht | `cloudflared` auf dem PC fehlt oder ist nicht im Pfad |
| `Access denied` nach dem Anmelden | Die E-Mail in B3 stimmt nicht mit der angemeldeten überein |
| `Permission denied (publickey)` | Tunnel steht, aber der Schlüsselpfad in C2 ist falsch |
| Tunnel `active`, aber keine Verbindung | DNS-Eintrag aus A5 fehlt oder zeigt woandershin |
