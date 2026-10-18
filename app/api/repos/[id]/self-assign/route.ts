import { NextResponse } from "next/server";
import { toggleRepoSelfAssign } from "@/lib/repo-service";

// req-047: der Schalter "Selbstauftrag". Eigene Route neben PATCH
// /api/repos/:id, weil der Schalter zum Repo gehört, nicht zur Task-Art —
// anders als jede andere Task-Art, die global ein- oder ausgeschaltet wird.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repos = await toggleRepoSelfAssign(id);
  return NextResponse.json({ repos });
}
