import { NextResponse } from "next/server";
import { restartAppContainer } from "@/lib/health-service";

// Neustart genau eines Containers (req-032) — der einzige Weg, auf dem appbaua
// je etwas neu startet, und er beginnt immer mit einem Klick des Nutzers. Es
// gibt bewusst keinen Auslöser dafür in der Prüfrunde.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    repoId?: unknown;
    container?: unknown;
  };
  if (typeof body.repoId !== "string" || typeof body.container !== "string") {
    return NextResponse.json({ error: "repoId und container nötig." }, { status: 400 });
  }
  const result = await restartAppContainer(body.repoId, body.container);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ container: result.container });
}
