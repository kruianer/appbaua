import { NextResponse } from "next/server";
import { restartContainer } from "@/lib/container-overview-service";

// Neustart genau eines Containers aus der Container-Übersicht (req-042) —
// derselbe Knopf wie bei den Prüfungen, aber direkt gegen die echte
// Container-Liste geprüft statt über eine App zugeordnet.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { id?: unknown };
  if (typeof body.id !== "string" || body.id === "") {
    return NextResponse.json({ error: "id nötig." }, { status: 400 });
  }
  const result = await restartContainer(body.id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ container: result.container });
}
