---
id: bug-041
app: appbaua
req: req-040
priority: normal
created: 2026-10-21
---

# Observed

Im Chat schlägt ein normales `git push` fehl mit "fatal: could not read
Username for 'https://github.com': No such device or address". Das Remote
ist als HTTPS-URL eingetragen, ohne hinterlegte Zugangsdaten. Ein
`GITHUB_TOKEN` steht zwar in der Umgebung, Git benutzt ihn aber nicht.
Pushen klappt nur, wenn Claude selbst einen Credential-Helper
dazugibt. Die Skills capture-bug und capture-requirement pushen mit
einem normalen `git push` und scheitern daran.

# Expected

Im Chat funktionieren `git push` und `git pull` direkt, ohne dass Claude
jedes Mal Zugangsdaten mitgeben muss (req-040: "committet und pusht").
Der Token steht dabei nicht im Klartext in der Remote-URL.
