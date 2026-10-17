import { listRepos } from "./repo-service";
import { type DockerClient, createDockerClient } from "./docker";
import { type ContainerOverview, buildContainerOverview } from "./container-overview";

// Anwendungsdienst der Container-Übersicht (req-042). Die Route bleibt dünn
// und ruft hierher; die Tests fassen diese Funktion direkt an.

export async function readContainerOverview(deps?: {
  docker?: DockerClient;
}): Promise<ContainerOverview> {
  const docker = deps?.docker ?? createDockerClient();
  const [repos, containers] = await Promise.all([listRepos(), docker.list()]);
  return buildContainerOverview(repos, containers, new Map());
}
