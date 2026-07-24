# Deploy-Setup (Beelink Mini-PC)

Diese Anleitung beschreibt die **einmalige** Einrichtung auf dem Beelink
EQR5 (Ubuntu), damit `git push` automatisch deployt. Die Repo-Seite
(Dockerfile, docker-compose.yml, GitHub-Actions-Workflow) ist bereits im
Repo — hier geht es um die Maschinen-Seite.

Zusammenhang: siehe [devops.md](devops.md). Push auf `dev` deployt die
dev-Umgebung, Merge auf `main` die prod-Umgebung. Auslöser ist der
Workflow `.github/workflows/deploy.yml` auf dem self-hosted Runner mit
Label **`appbaua`**.

Ausgangslage (Stand Einrichtung): Docker + Compose, node und git sind auf
dem Host schon vorhanden. Es laufen bereits andere Projekte (cellarvoice,
livinggardentwin, …) — appbaua bekommt deshalb einen **eigenen Runner
(Label `appbaua`)**, **eigene Ports** und **eigene Env-Dateien**, ohne
Bestehendes anzufassen.

## Phasen

- **Phase 1 (jetzt): nur im WLAN.** Die App ist unter
  `http://192.168.2.200:8090` (dev) erreichbar. Kein HTTPS, kein DNS.
- **Phase 2 (später): Cloudflare Tunnel.** dev.appbaua.com /
  app.appbaua.com über den bestehenden `cloudflared`-Tunnel (wie
  cellarvoice). HTTPS ist dann Pflicht (Kamera/Mikrofon auf iOS, siehe
  [stack.md](stack.md)).

## 1. Runner für appbaua registrieren

Auf GitHub: Repo → Settings → Actions → Runners → **New self-hosted
runner** → Linux. GitHub zeigt einen **Registrierungs-Token**.

Auf dem Beelink (eigener Ordner, damit die anderen Runner unberührt
bleiben):

```bash
mkdir -p ~/actions-runner-appbaua && cd ~/actions-runner-appbaua
tar xzf ~/actions-runner/actions-runner-linux-x64-2.334.0.tar.gz
./config.sh --url https://github.com/kruianer/appbaua \
  --token <REGISTRIERUNGS-TOKEN> \
  --name beelink-appbaua \
  --labels appbaua \
  --unattended
```

Als Dienst installieren und starten (**braucht sudo → du**):

```bash
sudo ./svc.sh install
sudo ./svc.sh start
```

## 2. Env-Datei mit Secrets anlegen (NICHT im Repo)

Der Workflow liest die Env-Datei aus `~/appbaua-env/`.

```bash
mkdir -p ~/appbaua-env
nano ~/appbaua-env/dev.env
```

Inhalt `dev.env` (Werte anpassen, starkes DB-Passwort wählen):

```
APP_PORT=8090
POSTGRES_USER=appbaua
POSTGRES_PASSWORD=<starkes-passwort-dev>
POSTGRES_DB=appbaua_dev
GITHUB_TOKEN=<fine-grained-PAT-fuer-repo-erreichbarkeit>
```

Rechte einschränken:

```bash
chmod 600 ~/appbaua-env/dev.env
```

> Hinweis: `GITHUB_TOKEN` hier ist der PAT für den Repo-Erreichbarkeits-
> test der App (req-001) — NICHT der Runner-Registrierungs-Token.

Für prod später analog `~/appbaua-env/prod.env` mit eigenem Port
(z.B. 8091), eigener DB und eigenem Passwort.

## 3. Erster Deploy

Sobald Runner (Phase 1) läuft und `dev.env` existiert, löst der nächste
**Push auf `dev`** den Workflow aus: Test-Gate → Build → Container-Start.
Man kann ihn auch manuell in GitHub (Actions → deploy → Run) anstoßen,
oder auf dem Host direkt testen:

```bash
cd ~/actions-runner-appbaua/_work/appbaua/appbaua   # Runner-Workspace nach 1. Lauf
docker compose -p appbaua-dev --env-file ~/appbaua-env/dev.env up -d --build
docker compose -p appbaua-dev logs -f app
```

Dann `http://192.168.2.200:8090` öffnen.

## 4. Cloudflare Tunnel (Phase 2, später)

appbaua als Ingress-Einträge in den bestehenden Tunnel aufnehmen
(analog `app.cellarvoice.com` → `localhost:3002`):

```yaml
# ~/.cloudflared/config.yml  (Ausschnitt)
ingress:
  - hostname: dev.appbaua.com
    service: http://localhost:8090
  - hostname: app.appbaua.com
    service: http://localhost:8091
  # ... bestehende Einträge ...
  - service: http_status:404
```

DNS-Route je Hostname (einmalig):

```bash
cloudflared tunnel route dns <tunnel-name> dev.appbaua.com
cloudflared tunnel route dns <tunnel-name> app.appbaua.com
```

Danach Tunnel neu laden. HTTPS liefert Cloudflare automatisch.

## Was der Worker NIE tut

- Nie nach prod deployen, nie auf `main` mergen/pushen. Prod-Deploy
  passiert nur, wenn DU den PR `dev → main` merged (siehe devops.md).
```
