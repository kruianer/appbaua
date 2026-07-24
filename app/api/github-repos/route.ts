import { NextResponse } from "next/server";
import { listGithubRepos } from "@/lib/github-repos";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repos = await listGithubRepos();
    return NextResponse.json({ repos });
  } catch {
    return NextResponse.json({ repos: [] });
  }
}
