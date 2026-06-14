import { test as base } from '@playwright/test';
import { resetDb } from './helpers/db';
import { getRuntimeInfo } from './helpers/runtime';

/**
 * Reset the server's debug time offset (see helpers/debug.ts). The offset is
 * process-global state in the flask app, so a test that fails between
 * setTimeOffset() and its own cleanup would otherwise poison every test after
 * it. Tolerates 404 so the suite can still target a non-debug server.
 */
async function resetServerClock(baseURL: string): Promise<void> {
  const resp = await fetch(`${baseURL}/debug/set_time_offset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset_seconds: 0 }),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`resetting debug time offset failed: HTTP ${resp.status}`);
  }
}

/**
 * Project-wide test fixture: every test starts from a pristine database
 * (schema + sample data) and the real wall-clock time. Import `test`/`expect`
 * from here, not from '@playwright/test', so the isolation is automatic.
 */
export const test = base.extend<{ pristineDb: void }>({
  // The container is published on a random host port (global-setup), so the
  // base URL is resolved per worker from the runtime file rather than baked
  // into playwright.config.ts.
  baseURL: [
    async ({}, use) => {
      await use(getRuntimeInfo().baseURL);
    },
    { option: true },
  ],
  pristineDb: [
    async ({ baseURL }, use) => {
      await resetDb();
      await resetServerClock(baseURL!);
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
