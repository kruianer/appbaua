import { NextResponse } from "next/server";
import { readSystemMetrics } from "@/lib/system-metrics-host";

// System-Kacheln der Einstellungsseite (req-009). Gemessen wird nur auf
// Anfrage — ist die Seite zu, fragt niemand, und der Server misst nichts.
export const dynamic = "force-dynamic";

export async function GET() {
  const metrics = await readSystemMetrics();
  return NextResponse.json(metrics);
}
