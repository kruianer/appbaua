import { NextResponse } from "next/server";
import { setDaySchedule } from "@/lib/task-service";
import { WEEKDAYS, type Weekday } from "@/lib/task-types";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const day = body.day as Weekday;

  if (!WEEKDAYS.includes(day)) {
    return NextResponse.json({ error: "Ungültiger Wochentag." }, { status: 400 });
  }

  const result = await setDaySchedule(id, day, {
    enabled: !!body.enabled,
    start: body.start ?? null,
    end: body.end ?? null,
  });

  if (result.ok) {
    return NextResponse.json({ types: result.types });
  }

  const messages: Record<string, string> = {
    "invalid-window":
      "Start- und Endzeit müssen sich unterscheiden. Ein Fenster über Mitternacht (z. B. 22:00–06:00) ist erlaubt.",
    "not-found": "Task-Typ nicht gefunden.",
  };
  return NextResponse.json(
    { error: messages[result.error] ?? "Fehler." },
    { status: 400 },
  );
}
