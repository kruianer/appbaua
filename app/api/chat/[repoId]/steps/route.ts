import { NextResponse } from "next/server";
import { getChatSteps } from "@/lib/chat-session-manager";

// req-048: der Chat-Tab pollt hierueber den aktuellen Stand der Schritte eines
// laufenden (oder gerade erst beendeten) Zugs — denselben Ereignisstrom, den
// der Worker über onOutput/describeEvent längst zeigt (claude-runner.ts).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ repoId: string }> },
) {
  const { repoId } = await params;
  return NextResponse.json({ steps: getChatSteps(repoId) });
}
