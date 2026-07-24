import { NextResponse } from "next/server";
import { reorderRepos } from "@/lib/repo-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const orderedIds: string[] = Array.isArray(body.orderedIds)
    ? body.orderedIds
    : [];
  const repos = await reorderRepos(orderedIds);
  return NextResponse.json({ repos });
}
