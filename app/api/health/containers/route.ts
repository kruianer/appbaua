import { NextResponse } from "next/server";
import { readContainerOverview } from "@/lib/container-overview-service";

// Container-Übersicht (req-042): Speicher und CPU aller Container, gruppiert
// nach App.
export const dynamic = "force-dynamic";

export async function GET() {
  const overview = await readContainerOverview();
  return NextResponse.json(overview);
}
