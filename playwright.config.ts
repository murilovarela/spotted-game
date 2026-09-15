import { loadEnvConfig } from "@next/env";
import { defineConfig, devices } from "@playwright/test";

// Same .env.local resolution as Next; in CI the job's env provides everything.
loadEnvConfig(process.cwd());

const CI = Boolean(process.env.CI);
// Set to run the suite against a deployed app (e.g. after `vercel --prod`) instead of a
// local dev/build server. There is nothing to spawn in that case — DATABASE_URL must point
// at the same database the deployment uses, since global setup seeds through it directly.
const REMOTE = process.env.PLAYWRIGHT_BASE_URL;
const baseURL = REMOTE ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  workers: 1, // specs share the seeded games
  retries: 0,
  reporter: CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    storageState: "e2e/.auth/user.json",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] }, testMatch: /ui\.spec\.ts/ },
  ],
  webServer: REMOTE
    ? undefined
    : {
        command: CI ? "npm run build && npm run start" : "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !CI,
        timeout: 240_000,
        // E2E never calls Gemini: the paste backend composites deterministically. Playwright
        // merges this over process.env. Locally, `reuseExistingServer` means an already-running
        // dev server keeps its own mode — start the suite with no dev server on :3000 when
        // exercising generate.spec.ts.
        env: { GENERATION_MODE: "paste" },
      },
});
