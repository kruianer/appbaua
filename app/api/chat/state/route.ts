import { NextResponse } from "next/server";
import { getChatUiStateStore } from "@/lib/chat-store";

// req-040: welches Repo der Chat zuletzt offen hatte, damit die Ansicht es
// beim nächsten Öffnen vorauswählt.
export async function GET() {
  const activeRepoId = await getChatUiStateStore().getActiveRepoId();
  return NextResponse.json({ activeRepoId });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { repoId?: unknown };
  const repoId = typeof body.repoId === "string" ? body.repoId : "";
  if (!repoId) {
    return NextResponse.json({ error: "repoId fehlt" }, { status: 400 });
  }
  await getChatUiStateStore().setActiveRepoId(repoId);
  return NextResponse.json({ ok: true });
}
