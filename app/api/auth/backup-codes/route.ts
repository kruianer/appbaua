import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth-request";
import { backupCodeStatus, issueBackupCodes } from "@/lib/auth-recovery";

// req-031: every user manages only their own backup codes — the id always
// comes from the session (currentUser), never from the request, so nobody
// (not even the operator) can act on someone else's codes.

export async function GET() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const status = await backupCodeStatus(user.id);
  return NextResponse.json(status);
}

export async function POST() {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const backupCodes = await issueBackupCodes(user.id);
  return NextResponse.json({ backupCodes });
}
