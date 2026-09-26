// Standalone worker process (req-004/006). Runs the execution loop server-side,
// independent of the web app, and invokes Claude Code for real work. Started as
// its own container in docker-compose (service "worker"), sharing Postgres.

import { runForever } from "../lib/worker-loop";
import { installProcessTreeCleanup } from "../lib/workspace";

// Ein Ende des Workers nimmt seine laufenden Kindprozesse mit (bug-023). Seit
// jeder Aufruf in einer eigenen Prozessgruppe laeuft, stirbt sie nicht mehr
// automatisch mit der unseren — vier vitest-Prozesse aus einem abgebrochenen
// Lauf hielten so sechs Tage lang 4,7 GB.
installProcessTreeCleanup();

// Never let a stray rejection/exception kill the worker silently — log and keep
// going. runForever already guards each pass; these are the last-resort nets.
process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("[worker] unhandledRejection:", reason);
});
process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("[worker] uncaughtException:", err);
});

async function main() {
  // eslint-disable-next-line no-console
  console.log("[worker] starting execution loop (Claude Code)");
  // runForever never returns; if it somehow does or throws, restart the loop
  // instead of exiting (container restart would also cover this, but this keeps
  // state and logs cleaner).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await runForever();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[worker] runForever crashed, restarting in 10s:", err);
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

main();
