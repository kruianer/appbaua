import { NextResponse } from "next/server";
import { readReleaseInfos } from "@/lib/release-info-service";

// Release-Infos aller Repos, neueste zuerst (req-046).
export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await readReleaseInfos();
  return NextResponse.json({ entries });
}
