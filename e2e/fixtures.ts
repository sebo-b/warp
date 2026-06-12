import { test as base } from '@playwright/test';
import { resetDb } from './helpers/db';

/**
 * Project-wide test fixture: every test starts from a pristine database
 * (schema + sample data). Import `test`/`expect` from here, not from
 * '@playwright/test', so DB isolation is automatic.
 */
export const test = base.extend<{ pristineDb: void }>({
  pristineDb: [
    async ({}, use) => {
      await resetDb();
      await use();
    },
    { auto: true },
  ],
});

export { expect } from '@playwright/test';
