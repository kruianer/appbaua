---
id: req-027
title: Aktivitätskarte zeigt das tatsächlich genutzte Claude-Modell
app: appbaua
area: Worker-Ausführung
priority: normal
created: 2026-07-26
changes: req-008
---

# Goal (Why)

Ich will auf der Aktivitätsseite sehen, mit welchem Claude-Modell der
Worker gerade arbeitet — damit ich erkennen kann, ob wirklich das
sparsame Modell (Sonnet) läuft und nicht ungewollt ein teureres, das mein
Limit schneller verbraucht.

# Function (What)

Während ein Schritt läuft, zeigt die Worker-Status-/Aktivitätskarte das
Modell an, das der laufende Claude-Code-Lauf TATSÄCHLICH benutzt. Die
Angabe stammt aus dem Claude-Event-Stream (dem "init"-Ereignis, das das
Modell nennt) — also das real verwendete Modell, nicht nur das
konfigurierte.

- Die Anzeige ist ein eigenes, gut erkennbares Feld auf der Karte, z.B.
  "Modell: sonnet".
- Sie erscheint nur, solange ein Schritt läuft; im Leerlauf/Pause/gestoppt
  wird kein Modell angezeigt.
- Das reale Modell wird schlicht angezeigt; eine Abweichung vom
  konfigurierten Modell wird NICHT besonders hervorgehoben (nur die
  Anzeige, keine Warnung).

# Acceptance Criteria

- [ ] Given ein Schritt läuft und der Claude-Lauf meldet im Event-Stream
  das Modell "sonnet", when ich die Aktivitätskarte ansehe, then sehe ich
  ein Feld "Modell: sonnet".
- [ ] Given ein Schritt läuft und der Claude-Lauf benutzt tatsächlich
  "opus", when ich die Karte ansehe, then zeigt das Feld "opus" (das
  reale Modell, nicht das erwartete).
- [ ] Given kein Schritt läuft (Leerlauf/Pause/gestoppt), when ich die
  Karte ansehe, then wird KEIN Modell-Feld angezeigt.

# Out of Scope

- Hervorheben/Warnen bei Abweichung vom konfigurierten Modell — nur
  anzeigen.
- Umschalten des Modells über die Oberfläche (das Modell wird im Code/der
  Konfiguration gesetzt, nicht im UI).
- Anzeige des Modells im Verlauf für zurückliegende Läufe — nur der
  laufende Schritt.
