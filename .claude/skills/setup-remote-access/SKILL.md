---
name: setup-remote-access
description: Legt fuer THIS project fest, wie die Umgebungen von aussen erreichbar sind — Web-Zugang der App ueber einen Cloudflare-Tunnel (dev und prod, ohne offenen Port am Router) und SSH-Zugang zum Host ueber Cloudflare Access, damit Betreiber und KI-Assistent auch ausserhalb des lokalen Netzes am Server arbeiten koennen. Schreibt die Vorgaben in delivery/devops.md und, wo Arbeit noetig ist, ein Requirement nach delivery/requirements/ready/. Nutze diesen Skill, wenn der Nutzer den Fernzugriff auf eine App oder ihren Server einrichten oder aendern will (z.B. "die App soll von aussen erreichbar sein", "Cloudflare Tunnel einrichten", "SSH von unterwegs", "Zero Trust", "ich brauche Remote-Zugriff auf den Beelink").
---

# Fernzugriff einrichten

Du legst fuer THIS project fest, wie seine Umgebungen von aussen
erreichbar sind — und schreibst das Ergebnis dorthin, wo es wirkt: die
Vorgaben in `delivery/devops.md`, und was noch gebaut werden muss als
Requirement nach `delivery/requirements/ready/`.

Zwei getrennte Dinge, die oft verwechselt werden:

- **Web-Zugang**: Menschen erreichen die App im Browser.
- **Host-Zugang**: Der Betreiber und sein KI-Assistent erreichen den
  Server per SSH, um zu deployen, Logs zu lesen und Stoerungen zu
  beheben.

Beides laeuft ueber Cloudflare-Tunnel, aus demselben Grund: Der Server
steht hinter einem Anschluss ohne feste IP, und es soll kein Port am
Router offen sein. Der Tunnel baut die Verbindung von innen nach aussen
auf.

Sprache: Fuehre den Dialog UND schreibe die Vorgaben in der Sprache, in
der der Nutzer mit dir spricht. Ausnahme (Maschinen-Vertrag): Dateinamen,
Ordnerpfade, Abschnitts-Ueberschriften der devops.md und die
Requirement-Ueberschriften bleiben unveraendert.

## Der Standard

### Web-Zugang: beide Umgebungen ueber Tunnel

**dev UND prod sind ueber je einen eigenen Cloudflare-Tunnel
erreichbar.** Nicht nur prod. Eine dev-Umgebung, die nur im WLAN laeuft,
kann der Betreiber unterwegs nicht pruefen — und sie waere die einzige
Umgebung ohne HTTPS, womit dort Passkeys gar nicht funktionieren
(WebAuthn braucht einen "secure context").

Je Umgebung ein eigener Tunnel, ein eigener Hostname, ein eigenes Token:

| Umgebung | Hostname | Token in |
|---|---|---|
| dev | `dev.<app-domain>` | `~/<app>-env/dev.env` |
| prod | `app.<app-domain>` | `~/<app>-env/prod.env` |

Der Tunnel laeuft als `cloudflared`-Container neben der App im selben
Compose-Projekt (`image: cloudflare/cloudflared:latest`,
`command: tunnel --no-autoupdate run --token ${CLOUDFLARE_TUNNEL_TOKEN}`).
Er bekommt **keine** `ports:`-Eintraege — er baut nur nach aussen auf.

**Kein Port am Router.** Weder fuer Web noch fuer SSH. Wenn eine
Anleitung eine Portfreigabe verlangt, ist sie fuer dieses Setup falsch.

### Host-Zugang: SSH ueber Cloudflare Access

**Ein SSH-Zugang pro Maschine, nicht pro Umgebung.** Der Beelink ist eine
Maschine; ob danach an dev- oder prod-Containern gearbeitet wird,
entscheidet der Befehl, nicht der Zugangsweg. Ein zweiter Tunnel
daneben brachte keinen zusaetzlichen Schutz, nur eine zweite Stelle zum
Pflegen.

| | |
|---|---|
| Hostname | `ssh.<haupt-domain>` |
| Ziel | `ssh://localhost:22` auf dem Host |
| Laeuft als | systemd-Dienst auf dem HOST, nicht im Container |
| Absicherung | Cloudflare Access, zusaetzlich zum SSH-Schluessel |

Der Tunnel laeuft bewusst auf dem Host und nicht in einem Container: Er
muss den SSH-Dienst des Hosts erreichen und auch dann verfuegbar sein,
wenn Docker steht — gerade dann braucht man ihn.

**Cloudflare Access ist Pflicht, nicht optional.** Ohne davor
vorgeschaltete Pruefung waere der SSH-Dienst der Maschine oeffentlich
erreichbar. Die Regel laesst genau eine Identitaet durch: die
E-Mail-Adresse des Betreibers, per Einmal-Code bestaetigt. Sitzungsdauer
24 Stunden.

**Der SSH-Schluessel bleibt trotzdem noetig.** Access entscheidet, WER
den Tunnel benutzen darf; SSH entscheidet, wer sich anmelden darf. Beides
zusammen, nie eines statt des anderen.

**Passwort-Anmeldung am SSH bleibt aus** (`PasswordAuthentication no`),
`PermitRootLogin no`. Ein oeffentlich erreichbarer SSH-Dienst mit
Passwortanmeldung wird binnen Stunden durchprobiert.

### Wie der Assistent den Zugang nutzt

Der KI-Assistent arbeitet ueber `ssh <alias>` — im lokalen Netz direkt,
von aussen ueber den Tunnel. Damit derselbe Befehl in beiden Faellen
funktioniert, gehoert in die `~/.ssh/config` des Arbeitsrechners ein
Eintrag mit `ProxyCommand`:

```
Host <app>-beelink
    HostName ssh.<haupt-domain>
    User <benutzer>
    IdentityFile ~/.ssh/<schluessel>
    IdentitiesOnly yes
    ProxyCommand cloudflared access ssh --hostname %h
```

Auf dem Arbeitsrechner muss `cloudflared` installiert sein. Beim ersten
Verbinden oeffnet sich der Browser fuer die Access-Pruefung; danach gilt
sie 24 Stunden.

Ein rein lokaler Eintrag (`HostName 192.168.x.x`) darf daneben bestehen
bleiben — er ist schneller, funktioniert aber nur im selben Netz. Wenn
beide existieren, benenne sie unterscheidbar (`<app>-beelink-lokal` und
`<app>-beelink`).

**Der Assistent bekommt KEINEN eigenen Zugang.** Er nutzt die Access-
Sitzung und den SSH-Schluessel des Betreibers, die in dessen
Benutzerprofil liegen — er ruft nur `ssh <alias>` auf und sieht die
Zugangsdaten nie. Zwei Folgen davon, die man kennen muss:

- Ist die Access-Sitzung abgelaufen, verlangt der naechste SSH-Befehl
  eine Bestaetigung im Browser. Das kann nur der Betreiber tun; der
  Assistent bleibt so lange stehen.
- Laeuft der Assistent nicht auf dem Rechner des Betreibers (z.B. eine
  Sitzung in der Cloud), hat er weder Schluessel noch Sitzung und kommt
  gar nicht durch. Ein Zugang von dort waere ein eigener Dienst-Zugang
  (Access Service Token) — eine andere Entscheidung als diese, und eine,
  die einen dauerhaften Zugang schafft, der auch dann besteht, wenn
  niemand hinschaut. Schlag ihn nicht von dir aus vor.

## Was der Betreiber selbst tun muss

Diese Schritte kann kein Skill und kein Worker uebernehmen — sie
verlangen Anmeldung im Cloudflare-Konto. Fuehre den Nutzer hindurch und
warte nach jedem Block auf seine Rueckmeldung:

**Fuer einen Web-Tunnel (je Umgebung):**

1. Cloudflare Zero Trust → Networks → Tunnels → "Create a tunnel" →
   Typ "Cloudflared".
2. Namen vergeben (z.B. `<app>-dev`), Token kopieren.
3. Public Hostname anlegen: Subdomain + Domain, Service
   `http://app:3000` (Container-Name und Port aus der Compose-Datei).
4. Token in `~/<app>-env/<umgebung>.env` als
   `CLOUDFLARE_TUNNEL_TOKEN=` eintragen.

**Fuer den SSH-Tunnel (einmal pro Maschine):**

1. Tunnel anlegen wie oben, Name z.B. `<host>-ssh`.
2. Public Hostname: `ssh.<haupt-domain>`, Service **`SSH`**,
   URL `localhost:22`.
3. Auf dem Host als Dienst einrichten:
   `sudo cloudflared service install <token>` — laeuft dann als
   systemd-Dienst und startet mit der Maschine.
4. **Access-Regel anlegen** (das ist der Schritt, der den Zugang
   schuetzt): Zero Trust → Access → Applications → "Add an application" →
   Self-hosted → Domain `ssh.<haupt-domain>` → Policy: Action "Allow",
   Include "Emails" = die Adresse des Betreibers. Session Duration
   24 Stunden.
5. Auf dem Arbeitsrechner `cloudflared` installieren und den
   `~/.ssh/config`-Eintrag von oben ergaenzen. Unter Windows:
   `winget install --id Cloudflare.cloudflared`, unter macOS
   `brew install cloudflared`.
6. Einmal `ssh <alias>` aufrufen: Der Browser oeffnet sich, der Betreiber
   bestaetigt mit seiner E-Mail-Adresse und dem Einmal-Code. Ab dann gilt
   die Sitzung 24 Stunden, und der Zugang funktioniert ohne weitere
   Eingabe.

Danach brauchts keine zusaetzlichen Zugangsdaten: Der SSH-Schluessel ist
derselbe wie im lokalen Netz, und die Access-Sitzung entsteht im Browser.

Ohne Schritt 4 ist der SSH-Dienst der Maschine oeffentlich erreichbar.
Sag das dem Nutzer deutlich, wenn er die Access-Regel ueberspringen will.

## Flow

### 1. Bestand aufnehmen (bevor du fragst)

- `delivery/devops.md`, Abschnitt `## Environments`: Welche Umgebungen,
  welche URLs, welcher Host?
- Laufen schon Tunnel? Auf dem Host:
  `docker ps --filter name=cloudflared` und
  `systemctl list-units --type=service | grep cloudflared`.
- Ist `cloudflared` auf dem Host installiert (`command -v cloudflared`)?
  Gibt es `~/.cloudflared/cert.pem`? Dann ist das Konto schon verbunden
  und es fehlt nur der neue Tunnel.
- Steht in der `docker-compose.yml` bereits ein `cloudflared`-Dienst?
- Wie erreicht der Assistent den Host heute — lokale IP oder Hostname?
  Eine lokale IP heisst: Fernzugriff fehlt noch.

Sag dem Nutzer, was du gefunden hast, bevor du Fragen stellst. Was schon
laeuft, wird nicht neu gebaut.

### 2. Hoechstens zwei Fragen

- **Welche Umgebungen brauchen Web-Zugang?** (Empfehlung: beide. Ohne
  HTTPS auf dev funktionieren dort keine Passkeys.)
- **Soll SSH von aussen erreichbar sein?** (Empfehlung: ja, mit Access
  davor. Ohne ihn ist Hilfe nur moeglich, solange man im selben WLAN
  ist.)

Frag NICHT nach Portfreigaben, nach der Access-Sitzungsdauer oder danach,
ob ein oder zwei SSH-Tunnel — das steht im Standard.

### 3. Schreiben

**In `delivery/devops.md`** — die Vorgaben, als eigener Abschnitt
`## Externer Zugang`: welche Hostnamen, welche Tunnel, wo die Tokens
liegen, wie der Assistent sich verbindet. Das ist Dauer-Dokumentation,
kein Arbeitsauftrag.

**Als Requirement nach `ready/`** — nur was am Repo zu aendern ist:
`cloudflared`-Dienst in die Compose-Datei, `CLOUDFLARE_TUNNEL_TOKEN`
durchreichen, `APP_ORIGIN` auf den neuen Hostnamen. Die
Cloudflare-Schritte selbst gehoeren NICHT ins Requirement — sie kann
niemand ausser dem Betreiber tun. Nenne sie stattdessen in der devops.md
und im Uebergabe-Text.

Gibt es am Repo nichts zu aendern (Tunnel laeuft schon, nur Access
fehlt), schreib KEIN Requirement — dann ist es reine
Betreiber-Handarbeit, und du fuehrst ihn nur hindurch.

### 4. Uebergeben

Sag in ein, zwei Saetzen: was du dokumentiert hast, welches Requirement
(falls eines) entstanden ist, und welche Schritte im Cloudflare-Konto
noetig sind. Weise auf das hin, was zutrifft:

- Ohne Access-Regel ist der SSH-Tunnel ein oeffentlich erreichbarer
  SSH-Dienst.
- Ohne `cloudflared` auf dem Arbeitsrechner funktioniert der
  `ProxyCommand`-Eintrag nicht.
- Ein Tunnel-Token gehoert in die env-Datei, nie ins Repo.

## Was du NIE tust

- Eine Portfreigabe am Router vorschlagen. Der ganze Sinn des Tunnels ist,
  ohne auszukommen.
- Einen Tunnel-Token, ein Zertifikat oder einen SSH-Schluessel ins Repo
  schreiben, in die Compose-Datei setzen oder im Chat wiedergeben. Sie
  gehoeren in die env-Dateien bzw. `~/.cloudflared/` auf dem Server.
- Den SSH-Tunnel ohne Cloudflare Access einrichten.
- `PasswordAuthentication` am SSH einschalten, um etwas zum Laufen zu
  bringen.
- Die Cloudflare-Schritte in ein Requirement schreiben, als koennte der
  Worker sie ausfuehren. Er hat keinen Zugang zum Konto des Betreibers.
- Einen laufenden Tunnel neu aufsetzen, weil es schneller scheint als
  nachzusehen, was er tut.
