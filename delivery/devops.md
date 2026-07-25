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
- Standardfall: NUR der Nutzer merged diesen PR. Der Worker öffnet ihn
  höchstens; er merged nie nach `main` und deployt nie selbst nach prod.
- Ausnahme (nur auf ausdrücklichen Wunsch): Bittet der Nutzer in einer
  konkreten Sitzung ausdrücklich darum, darf der Worker die Promotion für
  ihn ausführen (PR nach `main` mergen bzw. den Deploy nach prod
  auslösen). Diese Erlaubnis gilt NUR für die eine genannte Promotion —
  sie ist kein Dauer-Freibrief und nichts, was automatisch/unaufgefordert
  geschieht. Im Zweifel bleibt es beim Standardfall.
- Auch bei der Ausnahme gilt das Quality Gate unten unverändert: Der
  Nutzer muss die Änderung auf der dev-URL abgenommen haben und die
  Test-Suite muss grün sein.

## Acceptance / Quality Gate

- Der Nutzer nimmt Änderungen auf der dev/Staging-URL oben ab, bevor
  promotet wird.
- Eine Änderung, die auf der dev-URL nicht manuell überprüfbar ist, ist
  nicht fertig.

## Hard Rules

- Der Worker committet nur auf `dev`.
- Der Worker deployt nicht von sich aus nach prod, merged nicht von sich
  aus nach `main` und pusht nie direkt auf `main` (immer über PR). Nach
  prod/`main` geht es nur, wenn der Nutzer in der Sitzung ausdrücklich
  darum bittet — siehe Ausnahme unter „Promotion". Ohne diesen
  ausdrücklichen Wunsch bleibt prod/`main` für den Worker tabu.
- Nie autonom/unaufgefordert nach prod deployen oder auf `main` mergen —
  das passiert ausschließlich auf ausdrücklichen Wunsch des Nutzers.
