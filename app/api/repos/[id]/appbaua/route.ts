import { NextResponse } from "next/server";
import { convertRepoToAppbaua } from "@/lib/repo-service";

// req-012: the "Auf appbaua umstellen" button of a repo entry. Rolls the appbaua
// standard out into the repo and pushes it to that repo's dev branch. A failed
// rollout pushes nothing and answers with the concrete reason.

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await convertRepoToAppbaua(id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.error },
      { status: result.notFound ? 404 : 400 },
    );
  }
  return NextResponse.json({ message: result.message, summary: result.summary });
}
