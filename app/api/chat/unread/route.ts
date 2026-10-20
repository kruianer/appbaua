import { NextResponse } from "next/server";
import { getChatSessionStore } from "@/lib/chat-session-store";

// req-040 AC8: welche Repos eine fertige Antwort haben, die noch nicht
// angesehen wurde — der Hinweispunkt auf dem Chat-Knopf der unteren Leiste.
export async function GET() {
  const repoIds = await getChatSessionStore().listUnreadRepoIds();
  return NextResponse.json({ repoIds });
}
