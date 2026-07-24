import { NextResponse } from "next/server";
import { getWorkerState, setWorkerEnabled } from "@/lib/worker-state";

export async function GET() {
  const state = await getWorkerState();
  return NextResponse.json({ state });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => ({}));
  const state = await setWorkerEnabled(!!body.enabled);
  return NextResponse.json({ state });
}
