import { NextResponse } from "next/server";
import {
  readHealthOverview,
  runDueChecks,
  runDueLogAnalyses,
} from "@/lib/health-service";

// Zustandsübersicht (req-032). Die Antwort ist IMMER der zuletzt gespeicherte
// Stand — die fällige Prüfrunde wird nur angestoßen und nicht abgewartet.
//
// Warum nicht abwarten: die Prüfungen reden mit Docker, mit fremden Webadressen
// und mit einem KI-Anbieter. Beim ersten Aufruf nach dem Start liegt noch kein
// Ergebnis vor, und die Seite soll dann "noch nicht geprüft" zeigen, statt
// sekundenlang leer zu bleiben. Das Ergebnis der Runde kommt mit der nächsten
// Abfrage (die Seite fragt im Takt nach).
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await readHealthOverview();
  void runDueChecks().catch(() => {
    /* eine gescheiterte Runde darf die Seite nicht mitreißen */
  });
  // Dasselbe für die regelmäßige Log-Analyse (req-035): angestoßen, nicht
  // abgewartet — sie dauert Sekunden und ihr Ergebnis kommt mit der nächsten
  // Abfrage auf die Karte.
  void runDueLogAnalyses().catch(() => {
    /* eine gescheiterte Analyse darf die Überwachung nicht mitreißen */
  });
  return NextResponse.json(overview);
}
