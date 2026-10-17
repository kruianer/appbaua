import { NextResponse } from "next/server";
import { listRepos } from "@/lib/repo-service";
import { getChatSessionStore } from "@/lib/chat-session-store";
import { startChatTurn } from "@/lib/chat-session-manager";

// req-040: das Gespräch eines Repos lesen (GET) bzw. eine Nachricht schicken
// (POST). Der Versand selbst läuft im Hintergrund weiter (AC5/AC6): diese
// Route wartet NICHT auf Claudes Antwort — ein Lauf kann bis zu
// CLAUDE_TIMEOUT_MS dauern, und ein Repo-Wechsel darf nie auf einen anderen
// Lauf warten müssen. Die Antwort holt die Ansicht über das nächste GET.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params;
  const messages = await getChatSessionStore().listMessages(repoId);
  return NextResponse.json({ messages });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params;
  const body = (await request.json().catch(() => ({}))) as { content?: unknown };
  const content = typeof body.content === "string" ? body.content.trim() : "";
  if (!content) {
    return NextResponse.json({ error: "content fehlt" }, { status: 400 });
  }
  const repos = await listRepos();
  const repo = repos.find((r) => r.id === repoId);
  if (!repo) {
    return NextResponse.json({ error: "unknown-repo" }, { status: 404 });
  }
  // Fire-and-forget: der Turn läuft serverseitig weiter, egal was der Client
  // als Nächstes tut (AC5/AC6). Fehler daraus landen als Systemnachricht im
  // Gespräch selbst (sendChatMessage), nie als unbehandelte Ablehnung hier.
  void startChatTurn(repo, content);
  return NextResponse.json({ ok: true });
}
