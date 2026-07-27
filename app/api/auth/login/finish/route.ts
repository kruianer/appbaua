import { NextResponse } from "next/server";
import { finishLogin } from "@/lib/auth-webauthn";
import { signIn } from "@/lib/auth-cookie";

// req-023 AC2: a verified passkey grants a session.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.token || !body?.response) {
    return NextResponse.json({ error: "invalid-request" }, { status: 400 });
  }
  const result = await finishLogin(body.token, body.response);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  await signIn(result.userId);
  return NextResponse.json({ ok: true });
}
