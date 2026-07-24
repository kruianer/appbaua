# Deploy-Setup (Beelink Mini-PC)

Diese Anleitung beschreibt die **einmalige** Einrichtung auf dem Beelink
EQR5 (Ubuntu), damit `git push` automatisch deployt. Die Repo-Seite
(Dockerfile, docker-compose.yml, GitHub-Actions-Workflow) ist bereits im
Repo — hier geht es um die Maschinen-Seite, die nur du erledigen kannst.

Zusammenhang: siehe [devops.md](devops.md). Push auf `dev` deployt
dev.appbaua.com, Merge auf `main` deployt app.appbaua.com. Auslöser ist
der Workflow `.github/workflows/deploy.yml` auf dem self-hosted Runner.

## 1. Docker installieren

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER   # danach neu einloggen
docker compose version          # prüfen: v2.x
```

## 2. Self-hosted GitHub Runner registrieren

Auf GitHub: Repo → Settings → Actions → Runners → **New self-hosted
runner** → Linux. GitHub zeigt Befehle mit einem **Registrierungs-Token**
(nur du bekommst den). Auf dem Mini-PC:

```bash
mkdir -p ~/actions-runner && cd ~/actions-runner
# die von GitHub angezeigten curl/config.sh-Befehle ausführen ...
./config.sh --url https://github.com/kruianer/appbaua --token <TOKEN>
sudo ./svc.sh install     # als Dienst, läuft dauerhaft
sudo ./svc.sh start
```

Der Runner muss `docker` ausführen dürfen (Schritt 1, Gruppe `docker`).

## 3. Environment-Dateien anlegen (Secrets, NICHT im Repo)

Der Workflow erwartet die Env-Dateien unter `/etc/appbaua/`. Anlegen:

```bash
sudo mkdir -p /etc/appbaua
sudo nano /etc/appbaua/dev.env
```

Inhalt `dev.env` (Werte anpassen, starke Passwörter wählen):

```
APP_PORT=3001
POSTGRES_USER=appbaua
POSTGRES_PASSWORD=<starkes-passwort-dev>
POSTGRES_DB=appbaua_dev
GITHUB_TOKEN=<fine-grained-PAT-fuer-repo-erreichbarkeit>
```

Analog `prod.env` mit `APP_PORT=3002`, eigener DB und eigenem Passwort.
Rechte einschränken:

```bash
sudo chmod 600 /etc/appbaua/*.env
```

> Hinweis: `GITHUB_TOKEN` hier ist der PAT für den Repo-Erreichbarkeits-
> test der App (req-001) — NICHT der Runner-Registrierungs-Token.

## 4. Reverse-Proxy + HTTPS (Caddy empfohlen)

HTTPS ist Pflicht (siehe [stack.md](stack.md): Kamera/Mikrofon auf iOS
brauchen einen secure context). Caddy holt Let's-Encrypt-Zertifikate
automatisch.

```bash
sudo apt install -y caddy
sudo nano /etc/caddy/Caddyfile
```

```
dev.appbaua.com {
    reverse_proxy localhost:3001
}
app.appbaua.com {
    reverse_proxy localhost:3002
}
```

```bash
sudo systemctl reload caddy
```

## 5. DNS

Beim Domain-Anbieter A-Records (oder AAAA) setzen, die auf die
öffentliche IP des Mini-PCs zeigen:

- `dev.appbaua.com`  → <IP des Mini-PCs>
- `app.appbaua.com`  → <IP des Mini-PCs>

Router/Firewall: Ports 80 und 443 auf den Mini-PC weiterleiten (Caddy
braucht 80 für die Zertifikats-Challenge, 443 für HTTPS).

## 6. Erststart / Test

Nach Schritt 1–5 einmal manuell testen (ersetzt später der Workflow):

```bash
cd ~/appbaua   # geklontes Repo, oder der Runner-Workspace
docker compose -p appbaua-dev --env-file /etc/appbaua/dev.env up -d --build
docker compose -p appbaua-dev logs -f app
```

Dann https://dev.appbaua.com öffnen. Klappt das, löst ab jetzt jeder
Push auf `dev` den Deploy automatisch aus.

## Was der Worker NIE tut

- Nie nach prod deployen, nie auf `main` mergen/pushen. Prod-Deploy
  passiert nur, wenn DU den PR `dev → main` merged (siehe devops.md).
```
