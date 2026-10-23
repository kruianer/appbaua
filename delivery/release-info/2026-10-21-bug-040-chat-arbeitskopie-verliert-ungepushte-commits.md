---
repo: AppBaua
package: bug-040-chat-arbeitskopie-verliert-ungepushte-commits
date: 2026-10-21
---
Die Arbeitskopie im Chat behält jetzt ihren Stand über das ganze Gespräch: Was Claude committet oder geändert, aber noch nicht gepusht hat, bleibt in der nächsten Runde erhalten. Neue Änderungen vom Remote holt Claude selbst per `git pull`. Du musst nichts einstellen.
