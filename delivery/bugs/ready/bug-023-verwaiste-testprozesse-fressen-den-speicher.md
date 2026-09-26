---
id: bug-023
app: appbaua
req: req-006
priority: high
created: 2026-09-26
---

# Observed

Der Worker-Container hält Stunden bis Tage nach einem Lauf noch mehrere
Gigabyte belegt. Am 26.09. waren es **4,7 GB** — darin vier
`vitest`-Prozesse, gestartet am **19.09. um 20:17**, also seit **sechs
Tagen und neun Stunden** laufend:

```
PID      PPID     STARTED                ELAPSED       RSS
2591220  2401919  Sat Sep 19 20:17:07    6-09:34:28    1431652 kB
2602764  2401919  Sat Sep 19 20:21:03    6-09:30:31     909344 kB
2598271  2401919  Sat Sep 19 20:19:25    6-09:32:09     899336 kB
2604014  2401919  Sat Sep 19 20:21:33    6-09:30:01     653232 kB
```

PPID 2401919 ist `/sbin/docker-init -- docker-entrypoint.sh npm run worker`
— der Worker-Container.

Der Schaden trat außerhalb von appbaua ein: Mit 9,5 von 11 GB belegt und
Swap zu 100 % voll griff der OOM-Killer beim Prod-Deploy von wegfara und
erwischte nicht nur die Testsuite, sondern den **gesamten
Runner-Dienst**:

```
actions.runner.kruianer-wegfara...: Failed with result 'oom-kill'
Runner listener exit with 0 return code, stop the service, no retry needed.
```

Der Dienst startet nicht von selbst neu. Der nächste Deploy lag danach
**41 Minuten in `queued`**, weil kein Runner ihn annehmen konnte, und
musste von Hand wieder gestartet werden (`sudo systemctl start`).

# Expected

Beendet ein Worker-Lauf, laufen keine Prozesse aus ihm weiter. Ein Lauf,
der abbricht oder abgebrochen wird, nimmt seine Kindprozesse mit.

Der Speicher des Containers geht nach einem Lauf auf sein Grundmaß
zurück, ohne dass ihn jemand neu startet.

# Steps

1. Worker mehrere Requirements abarbeiten lassen, die Tests ausführen.
2. Nach dem letzten Lauf abwarten, bis der Worker in den Leerlauf geht.
3. `docker stats --no-stream` → der Worker hält mehrere GB.
4. `pgrep -af vitest` auf dem Host → Prozesse mit Startzeiten aus
   früheren Läufen.

# Ursache

Nicht dasselbe wie bug-018, und der damalige Fix hilft hier nicht:

- **bug-018** waren **Zombies** — beendete Prozesse, deren Eintrag niemand
  abräumte. `init: true` löst das, weil `docker-init` alles abräumt, was
  es erbt.
- **Hier laufen die Prozesse noch.** Ein init räumt nur ab, was *beendet*
  ist; einen lebenden Enkelprozess bringt es nicht um. Deshalb behält der
  Container den Speicher, obwohl PID 1 korrekt `docker-init` ist.

Der Ablauf: Der Worker startet über `run()` in `lib/workspace.ts` die
Testsuite; die startet ihrerseits Worker-Prozesse (`tinypool`). Endet der
Lauf vorzeitig — Abbruch, Zeitüberschreitung, Rate-Limit, Fehler —, wird
das direkte Kind abgeräumt, die Enkel laufen weiter. Sie sind keine
Zombies, sondern beschäftigte Node-Prozesse mit je ~1 GB.

Passend dazu endete der wegfara-Testlauf im Deploy mit
`ERR_IPC_CHANNEL_CLOSED` („Channel closed") — genau das Bild, das
entsteht, wenn Pool-Prozesse ihren Eltern verlieren.

# Erwartete Behebung

- Ein beendeter oder abgebrochener Lauf beendet **den ganzen
  Prozessbaum**, nicht nur sein direktes Kind — etwa über eine eigene
  Prozessgruppe, die als Ganzes beendet wird.
- Für einen Lauf, der nicht auf ein Beenden reagiert, gibt es eine
  Zeitgrenze, nach der er hart beendet wird.
- Wie das umgesetzt wird, entscheidet die Umsetzung. Was nicht genügt:
  den Container regelmäßig neu zu starten oder ein Speicherlimit zu
  setzen, das ihn abschießt — das verdeckt die Ursache.

# Notes

Der Beelink trägt mehrere Projekte und mehrere Runner. Ein Dienst, der
Speicher ohne Obergrenze hält, gefährdet dort alles andere mit — hier
konkret einen Prod-Deploy und einen Systemdienst, der von Hand
wiederbelebt werden musste.

Zu prüfen wäre nebenbei, ob der wegfara-Runner-Dienst so eingerichtet
werden kann, dass er nach einem `oom-kill` von selbst wieder startet
(`Restart=always`). Das gehört nicht zu appbaua, hätte den Ausfall aber
auf Minuten begrenzt statt auf Stunden.
