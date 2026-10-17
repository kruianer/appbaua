import { NextResponse } from "next/server";
import { readContainerOverview, runContainerMeasurement } from "@/lib/container-overview-service";

// Container-Übersicht (req-042): Speicher und CPU aller Container, gruppiert
// nach App. Wie /api/health: die Antwort ist IMMER der zuletzt gemessene
// Stand, eine fällige Messrunde wird nur angestoßen, nicht abgewartet — sie
// braucht wegen der zwei CPU-Momentaufnahmen im Abstand spürbar Zeit.
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await readContainerOverview();
  void runContainerMeasurement().catch(() => {
    /* eine gescheiterte Runde darf die Seite nicht mitreißen */
  });
  return NextResponse.json(overview);
}
