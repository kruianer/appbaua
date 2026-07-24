import { NextResponse } from "next/server";
import { toggleAlways } from "@/lib/task-service";

export async function PATCH(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const types = await toggleAlways(id);
  return NextResponse.json({ types });
}
