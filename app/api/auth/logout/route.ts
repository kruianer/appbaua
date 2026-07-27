import { NextResponse } from "next/server";
import { signOut } from "@/lib/auth-cookie";

// req-023 AC4: ends the session and clears the cookie.
export async function POST() {
  await signOut();
  return NextResponse.json({ ok: true });
}
