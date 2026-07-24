// Standalone worker process (req-004). Runs the simulated execution loop
// server-side, independent of the web app. Started as its own container in
// docker-compose (service "worker"), sharing the same Postgres via PG* env.

import { runForever } from "../lib/worker-loop";

async function main() {
  // eslint-disable-next-line no-console
  console.log("[worker] starting simulated execution loop");
  await runForever();
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] fatal:", err);
  process.exit(1);
});
