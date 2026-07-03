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

// Regression: saving an edit dialog must refresh the table IN PLACE. The
// Save/Delete buttons are legacy Materialize `<a href="#!">` affordances;
// before the router guards (router.js initLinkInterception + the popstate
// hash-only check), clicking one performed a fragment navigation to
// /users#!, popstate remounted the whole view, and the fresh table's list
// request raced the still-in-flight save POST — the table then showed
// pre-commit (stale) data until a manual reload.
test.describe('edit dialog refreshes the table without remounting', () => {
  test('editing a user name updates the users table in place', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/users');
    await waitForViewReady(page, 'users');

    const row = page.locator('.tabulator-row').filter({ hasText: 'user1' });
    await expect(row).toBeVisible();
    await row.locator('.warp-icon-edit-alt').click();
    await expect(page.locator('#edit_modal')).toHaveClass(/open/);
    await page.locator('#name').fill('Renamed InPlace');
    await page.locator('#edit_modal_save_btn').click();

    // The row must reflect the change without any reload/navigation…
    await expect(page.locator('.tabulator-row').filter({ hasText: 'Renamed InPlace' })).toBeVisible();
    // …and the save button must not have rewritten the URL (no /users#!).
    expect(new URL(page.url()).hash).toBe('');
    expect(new URL(page.url()).pathname).toBe('/users');
  });

  test('editing a plan name updates the plans table in place', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans');
    await waitForViewReady(page, 'plans');

    const row = page.locator('.tabulator-row').filter({ hasText: 'Plan 1A' });
    await expect(row).toBeVisible();
    await row.locator('.warp-icon-edit').first().click();
    await expect(page.locator('#edit_modal')).toHaveClass(/open/);
    await page.locator('#plan_name').fill('Plan 1A renamed');
    await page.locator('#edit_modal_save_btn').click();

    await expect(page.locator('.tabulator-row').filter({ hasText: 'Plan 1A renamed' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    expect(new URL(page.url()).pathname).toBe('/plans');
  });
});