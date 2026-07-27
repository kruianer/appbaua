import { NextResponse } from "next/server";
import { finishRegistrationAndSignIn } from "@/lib/auth-finish-registration";

// req-023 AC7: registering the replacement passkey after a recovery signs
// the user back in, same as every other "finish registration" path.
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
