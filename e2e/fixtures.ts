import { test as base } from '@playwright/test';
import { resetDb } from './helpers/db';
import { BASE_URL } from './playwright.config';

/**
 * Reset the server's debug time offset (see helpers/debug.ts). The offset is
 * process-global state in the flask app, so a test that fails between
 * setTimeOffset() and its own cleanup would otherwise poison every test after
 * it — and even the next run, since global-setup reuses a running container.
 * Tolerates 404 so the suite can still target a non-debug server.
 */
async function resetServerClock(): Promise<void> {
  const resp = await fetch(`${BASE_URL}/debug/set_time_offset`, {
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
  pristineDb: [
    async ({}, use) => {
      await resetDb();
      await resetServerClock();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
