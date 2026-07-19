import { execSync } from "node:child_process";

// Shut the throwaway Redis down so nothing is left running after the suite.
export default async function globalTeardown() {
  const port = 6399;
  try {
    execSync(`redis-cli -p ${port} shutdown nosave`, { stdio: "ignore" });
    console.log(`[redis] shut down instance on :${port}`);
  } catch {
    // Either it was never ours to stop, or it's already gone. Nothing to do.
  }
}
