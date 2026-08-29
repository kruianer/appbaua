// Was beim Hochfahren des Servers einmal anlaufen soll (Next.js ruft `register`
// genau einmal pro Serverprozess auf).
//
// Bisher gab es dafür keinen Bedarf: die Prüfrunden der Zustandsübersicht
// (req-032) wurden von der Seite selbst angestoßen. Mit req-033 ändert sich
// das — von einem Ausfall soll man gerade dann erfahren, wenn man NICHT
// hinschaut, und der Bot muss auf Befehle warten, ohne dass ein Browser offen
// ist. Beides braucht einen mitlaufenden Takt, siehe lib/telegram-monitor.ts.
//
// Ohne hinterlegte Telegram-Zugangsdaten startet nichts; die App verhält sich
// dann exakt wie vorher.

export async function register(): Promise<void> {
  // Diese Datei wird für BEIDE Laufzeiten übersetzt, solange es eine
  // middleware.ts gibt — also auch für Edge, wo es weder `node:http` noch den
  // Postgres-Treiber gibt. Der Import steht deshalb IM positiven Zweig und
  // nicht hinter einem frühen `return`: nur so ersetzt der Bundler die
  // Bedingung durch `false` und wirft den ganzen Block samt seiner
  // Abhängigkeiten aus dem Edge-Bündel.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Der Build-Durchlauf soll gar nichts starten.
    if (process.env.NEXT_PHASE === "phase-production-build") return;
    const { startTelegramMonitor } = await import("./lib/telegram-monitor");
    startTelegramMonitor();
  }
}
