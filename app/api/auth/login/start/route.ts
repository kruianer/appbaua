import { NextResponse } from "next/server";
import { startLogin } from "@/lib/auth-webauthn";

// req-023: usernameless login — the browser's own credential picker decides
// which registered passkey to present, so this needs no identifying input.
export async function POST() {
  const { token, options } = await startLogin();
  return NextResponse.json({ token, options });
}
