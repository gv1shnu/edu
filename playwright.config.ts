import "dotenv/config";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/fixtures.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 15000 },
  use: {
    baseURL: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
    headless: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  reporter: [["list"], ["html", { open: "never" }]],
});
