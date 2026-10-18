import { NextResponse } from "next/server";
import { cancelChatTurn } from "@/lib/chat-session-manager";

// bug-030: beendet den gerade laufenden Claude-Lauf des Repos, falls einer
// läuft — der Stopp-Knopf im Chat. Das bisherige Gespräch bleibt stehen;
// sendChatMessage trägt den Abbruch selbst als Systemnachricht ein, sobald der
// Lauf sich beendet hat.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params;
  const cancelled = cancelChatTurn(repoId);
  return NextResponse.json({ ok: true, cancelled });
}
