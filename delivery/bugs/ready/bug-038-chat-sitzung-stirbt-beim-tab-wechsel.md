---
id: bug-038
app: appbaua
req: req-040
priority: normal
created: 2026-10-21
---

# Observed

Die Claude-Code-Sitzung im Chat überlebt offenbar nicht, wenn der Betreiber
den Tab wechselt (anderen Navigationsplatz der App bzw. Browser-Tab). Eine
laufende Arbeit von Claude bricht dabei ab bzw. ist beim Zurückkommen weg.

# Expected

Die Sitzung arbeitet im Hintergrund weiter, auch wenn der Chat nicht
sichtbar ist oder kein Client verbunden ist. Beim Zurückkehren sieht der
Betreiber den aktuellen Stand inkl. dessen, was in der Zwischenzeit passiert
ist. Abgebaut wird die Sitzung erst, wenn sie eine Zeit lang (z. B. eine
Stunde) nichts zu tun hatte — also weder gearbeitet hat noch eine neue
Nachricht kam.

# Steps (optional)

1. Im Chat eines Repos Claude eine Aufgabe geben, die länger dauert.
2. Während Claude arbeitet, den Tab wechseln.
3. Zurück zum Chat: Sitzung bzw. Arbeit ist nicht mehr da.
