import { listRepos } from "@/lib/repo-service";
import { listTaskTypes } from "@/lib/task-service";
import { AppShell } from "@/components/AppShell";

// Server component: load persisted lists, hand them to the client shell.
export const dynamic = "force-dynamic";

export default async function Home() {
  const [repos, taskTypes] = await Promise.all([
    listRepos(),
    listTaskTypes(),
  ]);
  return <AppShell initialRepos={repos} initialTaskTypes={taskTypes} />;
}
