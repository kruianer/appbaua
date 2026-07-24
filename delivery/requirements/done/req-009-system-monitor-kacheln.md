---
id: req-009
title: System-Monitor-Kacheln in den Einstellungen
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-24
changes: req-007
---

# Goal (Why)

Ich will in den Einstellungen auf einen Blick den Zustand des Mini-PCs
sehen — freien Speicherplatz, CPU-Last, RAM und wie stark der Worker
gerade arbeitet — damit ich Auslastung und drohende Engpässe früh
bemerke.

# Function (What)

Auf der Einstellungsseite (aus req-007) kommt ein Bereich "System" mit
vier Kacheln, die den Mini-PC (Host) insgesamt betreffen:

- **Freier Speicherplatz** — frei von gesamt (z.B. "312 GB frei von
  500 GB").
- **CPU-Last gesamt** — aktuelle CPU-Auslastung des Hosts in Prozent.
- **CPU-Last des Workers** — CPU-Nutzung des Worker-Prozesses,
  einschließlich des während eines Schritts laufenden Claude-Code-
  Prozesses (so sieht man, wann echte Arbeit läuft).
- **RAM** — genutzter/freier Arbeitsspeicher des Hosts.

Die Kacheln aktualisieren sich sekündlich, solange die Einstellungsseite
angezeigt wird. Verlasse ich die Einstellungen, wird kein Wert mehr
erhoben — weder im Frontend noch im Backend (kein Polling im Leerlauf).
Lässt sich ein einzelner Wert nicht ermitteln, zeigt die betreffende
Kachel "n/v"; die übrigen Kacheln funktionieren weiter.

# GUI

- Kein eigenes Mockup. Die Kacheln lehnen sich an das bestehende
  Nocturne-Design und die Dashboard-Kacheln aus req-005 an.
- Zielgerät: primär Smartphone (Hochformat), responsive — analog req-001.

# Acceptance Criteria

- [ ] Given ich öffne die Einstellungsseite, when sie angezeigt wird,
  then sehe ich einen Bereich "System" mit vier Kacheln: Freier
  Speicherplatz, CPU-Last gesamt, CPU-Last des Workers, RAM.
- [ ] Given die Einstellungsseite ist offen, when eine Sekunde vergeht,
  then sind die Kachelwerte aktualisiert (ohne Neuladen der Seite).
- [ ] Given ich wechsle von den Einstellungen zu einem anderen Tab, when
  ich weg bin, then werden keine System-Werte mehr abgefragt (kein
  weiteres Polling).
- [ ] Given ein Wert ist nicht ermittelbar, when die Kacheln angezeigt
  werden, then zeigt genau diese Kachel "n/v" und die anderen zeigen
  weiterhin ihre Werte.
- [ ] Given der Worker führt gerade einen Schritt mit Claude Code aus,
  when ich die Kachel "CPU-Last des Workers" betrachte, then ist der
  Wert deutlich höher als im Leerlauf.

# Constraints

- Die App läuft im Container; Disk-/CPU-/RAM-Werte sind Host-Werte. Die
  nötigen Host-Infos (z.B. /proc und der Datenträger) werden read-only in
  den App-Container gemountet, damit die App sie lesen kann. Kein
  Docker-Socket.
- "CPU-Last des Workers" erfordert, dass der App-Container die Prozesse
  des Worker-Containers (Worker-Loop + laufender Claude-Prozess) sehen
  bzw. deren CPU ermitteln kann. Der konkrete Mechanismus ist
  Umsetzungssache, muss aber ohne Docker-Socket auskommen.

# Out of Scope

- Verlaufsgrafiken/Historie der Werte (nur Momentanwerte).
- Werte für einzelne andere Container/Projekte auf dem Host.
- Alarme/Schwellwerte oder Benachrichtigungen bei hoher Last.
- Anzeige der System-Werte außerhalb der Einstellungsseite.
