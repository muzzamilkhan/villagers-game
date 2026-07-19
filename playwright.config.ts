import { defineConfig, devices } from "@playwright/test";

// Concurrency / latency harness for Villagers.
//
// Everything runs against a production build (`next build && next start`) so the
// numbers reflect real request/SSE latency, not Next dev's on-demand compile.
// A throwaway local Redis is started in global-setup and torn down after.
//
// Ports: app on 3100, Redis on 6399 — both chosen to avoid clashing with
// anything a developer might already have running on the defaults.

const APP_PORT = Number(process.env.VILLAGERS_TEST_PORT ?? 3100);
const REDIS_URL =
  process.env.VILLAGERS_TEST_REDIS_URL ?? "redis://127.0.0.1:6399";

// The pre-installed system Chromium (see PLAYWRIGHT_BROWSERS_PATH). We launch it
// by path so we never try to download a browser in a sandboxed environment.
const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_PATH ?? "/opt/pw-browsers/chromium";

export default defineConfig({
  testDir: "./e2e",
  // One shared game drives the whole scenario, so it's a single serial file.
  fullyParallel: false,
  workers: 1,
  // Generous: 11 browser contexts play two full rounds end to end.
  timeout: 5 * 60_000,
  expect: { timeout: 20_000 },
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "off",
    video: "off",
    launchOptions: { executablePath: CHROMIUM_PATH },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions: { executablePath: CHROMIUM_PATH } },
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${APP_PORT}`,
    url: `http://127.0.0.1:${APP_PORT}`,
    timeout: 240_000,
    reuseExistingServer: !process.env.CI,
    env: { REDIS_URL, NODE_ENV: "production" },
    stdout: "pipe",
    stderr: "pipe",
  },
});
