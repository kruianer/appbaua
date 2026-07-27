import { NextResponse } from "next/server";
import { getAuthStore } from "@/lib/auth-store";

// req-023: lets the login page decide whether to show "Ersteinrichtung" —
// only when truly no user exists yet. Public on purpose (same reasoning as
// the auth surface itself): it reveals nothing beyond what bootstrapOperator
// itself already gates, and hiding a working link in a fresh install would
// leave a first-time operator stuck, exactly what happened before this route
// existed.
export async function GET() {
  const count = await getAuthStore().countUsers();
  return NextResponse.json({ bootstrapped: count > 0 });
}
