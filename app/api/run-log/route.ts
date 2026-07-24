import { NextResponse } from "next/server";
import { getRunLogStore } from "@/lib/run-log-store";
import { LOG_PAGE_SIZE } from "@/lib/run-log";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? "0") || 0);
  const store = getRunLogStore();
  const [entries, total] = await Promise.all([
    store.list(page * LOG_PAGE_SIZE, LOG_PAGE_SIZE),
    store.count(),
  ]);
  const hasMore = (page + 1) * LOG_PAGE_SIZE < total;
  return NextResponse.json({ entries, total, page, hasMore });
}

// Manual "Verlauf-Log löschen" (req-007): wipes the whole log and nothing else.
// Allowed at any time, also while the worker is running.
export async function DELETE() {
  await getRunLogStore().clear();
  return NextResponse.json({ total: 0 });
}
