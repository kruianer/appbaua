import { listRepos, weeklyUsageByRepo } from "@/lib/repo-service";
import { listTaskTypes } from "@/lib/task-service";
import { getWorkerState } from "@/lib/worker-state";
import { AppShell } from "@/components/AppShell";

// Server component: load persisted lists, hand them to the client shell.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [repos, taskTypes, workerState] = await Promise.all([
    listRepos(),
    listTaskTypes(),
    getWorkerState(),
  ]);
  // req-044: how much of this week's budget each repo has used already.
  const weeklyUsage = await weeklyUsageByRepo(repos, new Date());
  return (
    <AppShell
      initialRepos={repos}
      initialTaskTypes={taskTypes}
      initialWorkerEnabled={workerState.enabled}
      initialWeeklyUsage={weeklyUsage}
    />
  );
}
