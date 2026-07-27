import { NextResponse } from "next/server";
import { redeemInvitation } from "@/lib/auth-invitation";

// req-023 AC5/AC6: redeeming a valid invitation is the only way to create a
// second user — redeemInvitation itself refuses an invalid/expired/used token.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const result = await redeemInvitation(token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    registrationToken: result.registration.token,
    options: result.registration.options,
  });
}
