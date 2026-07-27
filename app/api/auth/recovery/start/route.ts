import { NextResponse } from "next/server";
import { redeemBackupCode } from "@/lib/auth-recovery";

// req-023 AC7: a valid backup code starts a fresh passkey registration for
// its owner. The code itself is the credential here — no separate identity
// input, same as the login ceremony is usernameless.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.code !== "string") {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const result = await redeemBackupCode(body.code);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    token: result.registration.token,
    options: result.registration.options,
  });
}
