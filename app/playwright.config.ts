import { defineConfig, devices } from "@playwright/test";

// globalSetup populates PLAYWRIGHT_BASE_URL with the spawned next dev's port.
// Workers re-read process.env after globalSetup runs, so a plain const lookup
// resolves to the spawned stack's URL by the time tests execute.
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

// Headless by default. Pass --headed to debug interactively.
// Run only chromium by default — adding firefox/webkit later if cross-browser
// regressions actually surface.
export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,            // dashboard pages share Postgres state
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  globalSetup: "./e2e/global-setup.ts",
  globalTeardown: "./e2e/global-teardown.ts",
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
