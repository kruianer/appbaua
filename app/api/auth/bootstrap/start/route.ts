import { NextResponse } from "next/server";
import { bootstrapOperator } from "@/lib/auth-bootstrap";

// req-023 AC1: only ever does something in a truly empty environment.
export async function POST() {
  const result = await bootstrapOperator();
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }
  return NextResponse.json({
    token: result.registration.token,
    options: result.registration.options,
  });
}
