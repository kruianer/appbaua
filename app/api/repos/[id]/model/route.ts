import { NextResponse } from "next/server";
import { setRepoModel } from "@/lib/repo-service";
import { REPO_MODELS, type RepoModel } from "@/lib/repos";

// req-028: set the Claude model this repo's runs use. A body naming anything
// other than one of the four options is rejected — a typo must not silently
// fall through to whatever the store already had.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { model?: unknown };
  const model = body.model;
  if (typeof model !== "string" || !REPO_MODELS.includes(model as RepoModel)) {
    return NextResponse.json({ error: "invalid-model" }, { status: 400 });
  }
  const repos = await setRepoModel(id, model as RepoModel);
  return NextResponse.json({ repos });
}
