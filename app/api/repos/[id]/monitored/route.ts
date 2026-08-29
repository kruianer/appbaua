import { NextResponse } from "next/server";
import { toggleRepoMonitored } from "@/lib/repo-service";

// req-032: der Schalter "überwachen". Eigene Route neben PATCH /api/repos/:id,
// weil er eine eigene Entscheidung ist — ob der Worker an einem Repo arbeitet
// und ob appbaua seine App überwacht, hat nichts miteinander zu tun.
export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repos = await toggleRepoMonitored(id);
  return NextResponse.json({ repos });
}
