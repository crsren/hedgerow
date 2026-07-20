// End-to-end tests against a fully local atproto network — no Docker, no
// live network, no real accounts. `pnpm --filter demo e2e` (or `pnpm exec
// playwright test` from this directory).
//
// webServer.command boots the local net + AppView shim + `astro dev` (see
// ./e2e/serve.mjs); Playwright waits for `url` to respond before running
// specs, and tears the whole process tree down afterwards.
//
// Requires a Chromium install once: `pnpm --filter demo e2e:install`
// (`playwright install chromium`). CI-runnable headless as-is.
import { defineConfig, devices } from "@playwright/test";

const PORT = process.env.HEDGEROW_E2E_PORT ?? "4321";
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node e2e/serve.mjs`,
    url: BASE_URL,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
    env: { HEDGEROW_E2E_PORT: PORT },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
