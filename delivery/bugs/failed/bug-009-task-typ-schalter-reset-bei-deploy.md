---
id: bug-009
app: appbaua
req: req-002
priority: high
created: 2026-07-26
---

# Observed

Nach einem prod-Deployment sind die Einstellungen der Task-Typen
(on/off-Schalter bzw. "immer"/Zeitfenster) auf ihre Defaults
zurückgesetzt. Andere Einstellungen — insbesondere die Repo-Liste —
bleiben dabei erhalten; betroffen sind NUR die Task-Typ-Schalter.

# Expected

Ein Deployment ändert nichts an meinen Einstellungen. Die vor dem Deploy
gesetzten Task-Typ-Schalter (aktiv/inaktiv, immer/Zeitfenster) sind nach
dem Deploy unverändert erhalten — genauso wie die Repo-Liste erhalten
bleibt.

# Steps

1. Task-Typen konfigurieren (z.B. Code-Review auf inaktiv oder mit
   Zeitfenster statt "immer") und die Änderung speichern.
2. Ein prod-Deployment auslösen (Merge nach main).
3. Nach dem Deploy die Task-Steuerung ansehen: die Schalter stehen wieder
   auf Default, obwohl die Repo-Liste erhalten ist.

# Hinweis zur Ursache (Verdacht, bitte verifizieren)

Repo-Store und Task-Typ-Store nutzen dasselbe Seed-Muster ("leerer Store
-> Defaults seeden"). Dass NUR die Task-Typen zurückgesetzt werden, deutet
darauf hin, dass ihre Persistenz das Deploy nicht übersteht, während die
der Repos es tut — z.B. weil die `task_types`-Daten beim Deploy geleert/
neu erzeugt werden (Schema/Migration/Volume), oder weil die Task-Typen in
prod nicht in der DB, sondern im flüchtigen `.data/`-Verzeichnis des
Containers landen, das ein `docker compose up --build` neu aufsetzt. Der
Fix soll reproduce-first vorgehen und sicherstellen, dass die
Task-Typ-Einstellungen ein Deploy genauso überstehen wie die Repo-Liste.
