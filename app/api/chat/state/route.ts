import { NextResponse } from "next/server";
import { getChatUiStateStore } from "@/lib/chat-store";
import { getChatSessionStore } from "@/lib/chat-session-store";

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
  // Das Repo wird gerade geöffnet — ein Hinweispunkt auf dem Chat-Knopf
  // verschwindet damit (AC9).
  await getChatSessionStore().setUnread(repoId, false);
  return NextResponse.json({ ok: true });
}
