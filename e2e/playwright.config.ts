import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',

  // All tests share one database (reset before each test via the resetDb
  // fixture), so they must not run in parallel.
  fullyParallel: false,
  workers: 1,

  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],

  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',

  // baseURL is supplied per worker by the `baseURL` fixture override in
  // fixtures.ts, since the host port is random and only known after global
  // setup has started the container.
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
