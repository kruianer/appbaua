import { NextResponse } from "next/server";
import { readHealthSettings, updateHealthSettings } from "@/lib/health-service";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ settings: await readHealthSettings() });
}

// Prüfabstände und die Schalter je Prüfart (req-032). Der Dienst normalisiert,
// was hereinkommt — ein fehlendes oder unsinniges Feld fällt auf seine Vorgabe
// zurück, statt eine Prüfart versehentlich abzuschalten.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const settings = await updateHealthSettings(body);
  return NextResponse.json({ settings });
}
