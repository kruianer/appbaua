import { NextResponse } from "next/server";
import { listRepos } from "@/lib/repo-service";
import { listTaskTypes } from "@/lib/task-service";
import { getWorkerState } from "@/lib/worker-state";
import { getWorkerStatusStore } from "@/lib/worker-status";
import { getRunLogStore } from "@/lib/run-log-store";
import { buildDashboard, startOfTodayIso } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const now = new Date();
  const store = getRunLogStore();
  const [state, status, repos, taskTypes, today, lastError] =
    await Promise.all([
      getWorkerState(),
      getWorkerStatusStore().get(),
      listRepos(),
      listTaskTypes(),
      store.metricsSince(startOfTodayIso(now)),
      store.lastError(),
    ]);

  const data = buildDashboard({
    enabled: state.enabled,
    status,
    repos,
    taskTypes,
    today,
    lastError,
    now,
  });
  return NextResponse.json(data);
}
