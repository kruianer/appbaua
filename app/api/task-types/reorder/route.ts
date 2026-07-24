import { NextResponse } from "next/server";
import { reorderTaskTypes } from "@/lib/task-service";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const orderedIds: string[] = Array.isArray(body.orderedIds)
    ? body.orderedIds
    : [];
  const types = await reorderTaskTypes(orderedIds);
  return NextResponse.json({ types });
}
