import { NextResponse } from "next/server";
import { setRepoWeeklyBudget } from "@/lib/repo-service";

// req-044: set the weekly budget of Bugs+Requirements this repo may work off.
// `weeklyBudget: null` removes the limit; anything else must be a positive
// integer — a typo must not silently store garbage.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as {
    weeklyBudget?: unknown;
  };
  const value = body.weeklyBudget;
  if (value !== null && !(typeof value === "number" && Number.isInteger(value) && value >= 1)) {
    return NextResponse.json({ error: "invalid-weekly-budget" }, { status: 400 });
  }
  const repos = await setRepoWeeklyBudget(id, value);
  return NextResponse.json({ repos });
}
