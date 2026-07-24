import { NextResponse } from "next/server";
import { listTaskTypes } from "@/lib/task-service";

export async function GET() {
  const types = await listTaskTypes();
  return NextResponse.json({ types });
}
