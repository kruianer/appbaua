import { NextResponse } from "next/server";
import { addRepo, listRepos } from "@/lib/repo-service";

export async function GET() {
  const repos = await listRepos();
  return NextResponse.json({ repos });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const result = await addRepo({ url: body.url, name: body.name });

  if (result.ok) {
    return NextResponse.json({ repo: result.repo, repos: result.repos });
  }

  const messages: Record<string, string> = {
    empty: "Git-URL ist erforderlich.",
    duplicate: "Dieses Repo ist bereits in der Liste.",
    unreachable: "Repo nicht erreichbar oder kein Zugriff.",
  };
  return NextResponse.json(
    { error: messages[result.error] ?? "Fehler beim Hinzufügen." },
    { status: 400 },
  );
}
