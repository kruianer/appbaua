import { NextResponse } from "next/server";
import { listRepos } from "@/lib/repo-service";
import { getChatSessionStore } from "@/lib/chat-session-store";
import { sendChatMessage } from "@/lib/chat-session-manager";

// req-040: das Gespräch eines Repos lesen (GET) bzw. eine Nachricht schicken
// und auf Claudes Antwort warten (POST). Etappe 3: noch synchron — der
// nächste Schritt (AC5/AC6) macht den Versand hintergrundfähig, damit ein
// Repo-Wechsel nicht auf eine laufende Antwort eines anderen Repos wartet.
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
  await sendChatMessage(repo, content);
  const messages = await getChatSessionStore().listMessages(repoId);
  return NextResponse.json({ messages });
}
