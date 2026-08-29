import { NextResponse } from "next/server";
import { analyzeRepoLogs } from "@/lib/log-analysis-service";

// Die Log-Analyse auf Knopfdruck (req-035). Der Klick ist die ausdrückliche
// Entscheidung des Nutzers, deshalb hängt dieser Weg an keinem Schalter der
// Einstellungen — die schalten nur ab, was von allein passiert.
//
// Hier wird gewartet: der Nutzer hat gerade geklickt und will das Ergebnis
// sehen, nicht die nächste Abfrage der Seite abwarten.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { repoId?: unknown };
  if (typeof body.repoId !== "string") {
    return NextResponse.json({ error: "repoId nötig." }, { status: 400 });
  }
  const analysis = await analyzeRepoLogs(body.repoId, "manual");
  if (!analysis) {
    return NextResponse.json(
      { error: "Repo nicht gefunden oder nicht überwacht." },
      { status: 400 },
    );
  }
  return NextResponse.json({ analysis });
}
