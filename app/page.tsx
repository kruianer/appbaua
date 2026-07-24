import { listRepos } from "@/lib/repo-service";
import { AppShell } from "@/components/AppShell";

// Server component: load the persisted list, hand it to the client shell.
export const dynamic = "force-dynamic";

export default async function Home() {
  const repos = await listRepos();
  return <AppShell initialRepos={repos} />;
}
