---
project: appbaua
setup: 1
---

# DevOps Convention

Diese Datei ist verbindlich für den autonomen Worker. Befolge sie exakt.

## Environments

| Environment | Branch | URL                     |
|-------------|--------|-------------------------|
| dev         | dev    | https://dev.appbaua.com |
| prod        | main   | https://app.appbaua.com |

Hosting-Plattform: GitHub Actions (Runner auf Beelink EQR5 Mini-PC,
Ubuntu). Der Deploy läuft als GitHub-Actions-Workflow, ausgelöst durch
den Push — kein PaaS-Auto-Deploy, aber dieselbe Wirkung: git push ist der
Trigger.

## Deploy Trigger

- Push auf `dev`   → Workflow deployt automatisch die dev-Umgebung.
- Merge auf `main` → Workflow deployt automatisch prod.

Kein manueller Deploy-Schritt; der git push ist der Trigger.

## Promotion (dev → prod)

- Promotion passiert AUSSCHLIESSLICH über einen Pull Request von `dev`
  nach `main`.
- NUR der Nutzer merged diesen PR. Der Worker öffnet ihn höchstens; er
  merged nie nach `main` und deployt nie selbst nach prod.

## Acceptance / Quality Gate

- Der Nutzer nimmt Änderungen auf der dev/Staging-URL oben ab, bevor
  promotet wird.
- Eine Änderung, die auf der dev-URL nicht manuell überprüfbar ist, ist
  nicht fertig.

## Hard Rules

- Der Worker committet nur auf `dev`.
- Der Worker deployt NIE nach prod, merged nie nach `main`, pusht nie
  direkt auf `main`.
