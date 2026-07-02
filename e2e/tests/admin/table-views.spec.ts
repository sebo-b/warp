import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN } from '../../helpers/users';
import { waitForViewReady } from '../../helpers/spa';

// Coverage for the admin CRUD table VIEWS (the Tabulator ajax render path),
// which the other admin specs exercise only via direct /xhr POSTs
// (adminPost). That gap let a regression in the shared tablePage ajax layer
// (and a broken initialFilter value) ship green: the table's remote request
// 400'd, Tabulator fired dataLoadError and rendered zero rows, but no test
// ever loaded the UI table to notice. These load each table via the SPA
// router and assert real rows render (and that the initial account_type
// filter is applied, since that's the path that regressed).
test.describe('admin table views render data', () => {
  test('users table lists non-group accounts', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/users');
    await waitForViewReady(page, 'users');

    // initialFilter account_type < ACCOUNT_TYPE_GROUP keeps groups out and
    // real users in — assert a known user row appears and no group row does.
    await expect(page.locator('.tabulator-row').filter({ hasText: 'admin' })).toBeVisible();
    await expect(page.locator('.tabulator-row').filter({ hasText: 'user1' })).toBeVisible();
    await expect(page.locator('.tabulator-row').filter({ hasText: 'group_1a' })).toHaveCount(0);
  });

  test('groups table lists only group accounts', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/groups');
    await waitForViewReady(page, 'groups');

    await expect(page.locator('.tabulator-row').filter({ hasText: 'group_1a' })).toBeVisible();
    await expect(page.locator('.tabulator-row').filter({ hasText: 'group_parking' })).toBeVisible();
    // initialFilter account_type >= ACCOUNT_TYPE_GROUP hides regular users.
    await expect(page.locator('.tabulator-row').filter({ hasText: /\buser1\b/ })).toHaveCount(0);
  });

  test('zones table lists zones', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/zones');
    await waitForViewReady(page, 'zones');
    await expect(page.locator('.tabulator-row').filter({ hasText: 'Zone 1A' })).toBeVisible();
  });

  test('plans table lists plans', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans');
    await waitForViewReady(page, 'plans');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
  });
});