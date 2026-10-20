---
id: bug-026
app: appbaua
priority: high
created: 2026-10-17
---

# Observed

Der Rechner, auf dem alle Apps laufen, steht dauerhaft an der
Speichergrenze. Gemessen wenige Minuten nach einem Neustart, bevor
nennenswerte Arbeit lief:

```
Mem:  11 Gi gesamt · 9,7 Gi belegt · 140 Mi frei
Swap:  4 Gi gesamt · 434 Mi belegt
```

Am 14.10. um 03:14 hat der Kernel deshalb den Claude-Prozess des
Worker-Containers abgeschossen:

```
oom-kill: constraint=CONSTRAINT_NONE, global_oom,
          task_memcg=/system.slice/docker-085cae21….scope,
          task=claude.exe, uid=1001
Out of memory: Killed process 1059177 (claude.exe)
          total-vm:10.761.772 kB  anon-rss:9.256.192 kB
```

`085cae21…` ist `appbaua-prod-worker-1`. Ein einzelner Claude-Lauf hatte
also **9,2 GB** von 11 GB belegt — auf einem Rechner, der zugleich 52
Container für neun Apps trägt.

`global_oom` heißt: Dem GANZEN Rechner ging der Speicher aus, nicht
einem Container mit zu engem Limit. Der Kernel sucht sich dann selbst
ein Opfer. Beim nächsten Mal kann das eine Datenbank sein.

Kontrolliert: **Kein einziger der 52 Container hat ein Speicherlimit**
(`HostConfig.Memory == 0` bei allen). Jeder darf sich den gesamten
Arbeitsspeicher nehmen.

# Expected

Ein einzelner Worker-Lauf kann den Rechner nicht an die Speichergrenze
bringen. Läuft ein Lauf aus dem Ruder, trifft es ihn selbst — nicht eine
fremde App oder eine Datenbank.

# Steps

1. `free -h` auf dem Host: wenige hundert MB frei.
2. `docker inspect --format '{{.HostConfig.Memory}}'` über alle
   Container: überall `0`.
3. `journalctl | grep "Out of memory"`: der Kill vom 14.10., 03:14.

# Hinweis zur Ursache

Drei Dinge treffen zusammen:

1. **Der Worker hat kein Limit.** `docker-compose.yml` setzt für den
   `worker`-Dienst keine Speichergrenze.
2. **Ein Claude-Lauf kann sehr viel Speicher brauchen.** 9,2 GB sind
   belegt, nicht geschätzt.
3. **Der Rechner ist knapp.** 11 GB für 52 Container plus Worker.

**Was NICHT die Ursache ist** (geprüft, damit es nicht noch einmal
untersucht wird):

- *Die Festplatte.* Die I/O-Fehler vom 10.10. (`dev sda`, „device
  offline") stammen von einer externen USB-SSD (`Portable_SSD SSK_SSD`),
  die 33 Sekunden nach dem Einhängen beim Lesen abgezogen wurde. Die
  interne NVMe war nie betroffen; `sda` existiert heute nicht mehr.
- *Die ~130 `python3.12`-OOM-Kills in der 30-Tage-Summe.* Sie fallen
  ausschließlich auf den 07.10. (73) und 08.10. (58) und hören mit dem
  Neustart vom 08.10., 04:23 auf. Ein abgeschlossener Vorfall, kein
  Dauerzustand.
- *Der Netzwerkausfall.* Der Lauf, der zum Kill-Zeitpunkt lief
  (Wellarita, 02:55–04:06), endete **erfolgreich**. Der Kill hat ihn
  nicht abgebrochen.

Richtung für den Fix — bitte selbst abwägen:

Dem `worker`-Dienst in `docker-compose.yml` eine Speichergrenze geben,
damit ein entgleister Lauf nur sich selbst trifft. Die Höhe will
überlegt sein: zu eng, und normale Läufe sterben; zu weit, und die
Grenze schützt nicht. Ein gemessener Lauf brauchte 9,2 GB — ob das ein
Ausreißer war oder der Normalfall, ist offen und sollte vor der
Festlegung ermittelt werden.

Zu bedenken: Ein Limit verwandelt einen `global_oom` in einen Kill
innerhalb des Worker-Containers. Das ist besser (es trifft den
Verursacher), heißt aber, dass Läufe sichtbar scheitern werden, die
heute den Rechner mitreißen. req-038 unterscheidet bereits
Netzabbruch von Fehlschlag — ein OOM-Kill sollte als eigene Art
erkennbar sein und nicht als Netzfehler durchgehen.

# Out of Scope

- Limits für die Container der anderen Apps (LivingGardenTwin, Wegfara,
  Uftischa, CellarVoice, Knipsa). Dieselbe Lücke, aber fremde Repos —
  gehört dort entschieden.
- Mehr Arbeitsspeicher in den Rechner einbauen. Eine Möglichkeit, aber
  eine Anschaffung, die der Betreiber entscheidet.
- Die Frage, ob Läufe grundsätzlich weniger Speicher brauchen könnten.
