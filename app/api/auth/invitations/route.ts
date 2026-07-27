import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth-request";
import { createInvitation } from "@/lib/auth-invitation";

// req-023: only the operator may invite. Enforced here (not just "logged in
// somebody"), because a non-operator user must never be able to invite more
// people on their own.
export async function POST() {
  const user = await currentUser();
  if (!user?.isOperator) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const invitation = await createInvitation(user.id);
  return NextResponse.json({ token: invitation.token, expiresAt: invitation.expiresAt });
}
