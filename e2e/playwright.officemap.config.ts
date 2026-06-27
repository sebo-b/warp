import { defineConfig, devices } from '@playwright/test';

// Standalone config for the OfficeMap component's isolated e2e suite (Phase 1
// of PLAN_officemap.md). No container, no backend — just a tiny static server
// (serve.mjs) serving the test page + the real OfficeMap module + sprite +
// sample maps. Run with: npx playwright test --config=e2e/playwright.officemap.config.ts
export default defineConfig({
  testDir: './tests/officemap',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  use: {
    baseURL: `http://127.0.0.1:${process.env.OFFICEMAP_PORT || 7357}`,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'node serve.mjs',
    cwd: './tests/officemap',
    url: `http://127.0.0.1:${process.env.OFFICEMAP_PORT || 7357}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});