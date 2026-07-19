import { execSync } from "node:child_process";

// Spin up a disposable Redis for the test run. It listens on a non-default port
// (6399) with persistence disabled, so it leaves nothing behind on disk and
// won't collide with a developer's own redis-server on 6379.
//
// Playwright starts the `webServer` before this hook, but the Next app only
// touches Redis on the first API request (which happens once tests run), so
// bringing Redis up here — after the server boots, before any test — is safe.
export default async function globalSetup() {
  const port = 6399;
  try {
    // Already running from a previous run? Reuse it (and flush) instead of erroring.
    execSync(`redis-cli -p ${port} ping`, { stdio: "ignore" });
    console.log(`[redis] reusing existing instance on :${port}`);
  } catch {
    console.log(`[redis] starting throwaway instance on :${port}`);
    execSync(
      `redis-server --port ${port} --save "" --appendonly no --daemonize yes`,
      { stdio: "ignore" }
    );
    // Wait for it to accept connections.
    const deadline = Date.now() + 10_000;
    for (;;) {
      try {
        execSync(`redis-cli -p ${port} ping`, { stdio: "ignore" });
        break;
      } catch {
        if (Date.now() > deadline) {
          throw new Error(`Redis on :${port} did not come up in time`);
        }
      }
    }
  }
  // Start each run from a clean slate.
  execSync(`redis-cli -p ${port} flushall`, { stdio: "ignore" });
}
