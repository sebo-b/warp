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
 * Reset the deployment language to English (see helpers/debug.ts setLanguage).
 * LANGUAGE_FILE is process-global state; a test that switches language would
 * otherwise poison every test after it. Tolerates 404 for a non-debug server.
 */
async function resetServerLanguage(baseURL: string): Promise<void> {
  const resp = await fetch(`${baseURL}/debug/set_language`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language_file: 'i18n/en.json' }),
  });
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`resetting language failed: HTTP ${resp.status}`);
  }
}

/**
 * Project-wide test fixture: every test starts from a pristine database
 * (schema + sample data), real wall-clock time, and the default language.
 * Import `test`/`expect` from here, not from '@playwright/test', so the
 * isolation is automatic.
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
      await resetServerLanguage(baseURL!);
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
