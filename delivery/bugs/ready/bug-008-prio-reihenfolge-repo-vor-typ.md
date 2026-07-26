---
id: bug-008
app: appbaua
priority: high
created: 2026-07-26
---

# Observed

Der Worker arbeitet in falscher Prioritäts-Reihenfolge: Aktuell hat der
Task-Typ Vorrang vor dem Repo. In `lib/scheduling.ts` (planRun) ist die
Task-Typ-Schleife außen und die Repo-Schleife innen — es wird also erst
ein Task-Typ über ALLE Repos abgearbeitet, dann der nächste Task-Typ über
alle Repos. Der Code-Kommentar sagt das ausdrücklich so ("task-type
priority is the OUTER loop").

# Expected

Die Repo-Priorität hat Vorrang vor dem Task-Typ. Der Worker arbeitet Repo
1 vollständig ab (alle fälligen Task-Typen in ihrer Prio-Reihenfolge),
erst wenn es dort nichts mehr zu tun gibt, geht er zu Repo 2, usw. Also:
Repo-Schleife außen, Task-Typ-Schleife innen. Entspricht der Vision
("Der Worker geht die Repos in ihrer Prio-Reihenfolge durch … Repo 1 vor
Repo 2 vor Repo 3").

# Steps

1. Mehrere aktive Repos (Prio 1, 2) und mehrere fällige Task-Typen
   konfigurieren.
2. Den geplanten Ablauf ansehen (planRun / Vorschau): aktuell wird ein
   Task-Typ über beide Repos gemacht, bevor der nächste Task-Typ startet
   — statt Repo 1 komplett vor Repo 2.
