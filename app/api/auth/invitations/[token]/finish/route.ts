import { NextResponse } from "next/server";
import { finishRegistrationAndSignIn } from "@/lib/auth-finish-registration";

// req-023 AC5: an invited person's passkey is verified the same way as the
// operator's own (the invitation itself already granted the user row).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.token || !body?.response) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const result = await finishRegistrationAndSignIn(body.token, body.response, {
    withBackupCodes: true,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, backupCodes: result.backupCodes });
}
