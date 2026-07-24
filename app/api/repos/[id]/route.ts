import { NextResponse } from "next/server";
import { removeRepo, toggleRepo } from "@/lib/repo-service";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repos = await toggleRepo(id);
  return NextResponse.json({ repos });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const repos = await removeRepo(id);
  return NextResponse.json({ repos });
}
