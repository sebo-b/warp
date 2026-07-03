/**
 * UI-level coverage for the two "assign members" admin views:
 *   /zones/assign/<zid>   (zoneAssign)
 *   /groups/assign/<login> (groupAssign)
 *
 * Why this file exists: the other admin specs exercise /xhr/zones/members and
 * /xhr/groups/members only via direct adminPost() with a hand-built TAB body
 * (always including `size`). That gap let three regressions ship green:
 *   - the shared tabulatorSchema rejected Tabulator's real payload, which
 *     sends `page` WITHOUT `size` (paginationSize auto-calcs to 0 when the
 *     assign table's flex container has 0 clientHeight at first paint) -> 400;
 *   - groupAssign.js used `safeReturn` without importing it -> mount() threw a
 *     ReferenceError before the table was even created;
 *   - zoneAssign.js used `createUserPicker` without importing it -> mount()
 *     threw after the table request fired.
 * None of those are reachable through endpoint-only tests; these drive the
 * views through the SPA router and the shared user picker so the real mount +
 * Tabulator ajax + picker path is covered.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { waitForViewReady } from '../../helpers/spa';

// The Materialize autocomplete renders its suggestions as <li data-id="label">
// inside a top-layer popover; Playwright's actionability checks choke on the
// popover, so drive the selection with a real DOM click() instead.
async function pickUser(page: any, inputSelector: string, login: string, label: string) {
  const input = page.locator(inputSelector);
  await input.fill(login);
  await page.waitForTimeout(400);
  await page.locator('.autocomplete-content li').filter({ hasText: label }).first().evaluate((el: HTMLElement) => el.click());
}

test.describe('zone assign view', () => {
  test('loads and lists assigned members', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/zones/assign/1');
    await waitForViewReady(page, 'zoneAssign');
    await expect(page.locator('#zone_assign_title_text')).toHaveText(/Zone 1A/);
    const rows = page.locator('#zone_assignees_table .tabulator-row');
    // sample data: zone 1 has user1 (admin), group_1a (user), admin (admin)
    await expect(rows.filter({ hasText: 'user1' })).toBeVisible();
    await expect(rows.filter({ hasText: 'group_1a' })).toBeVisible();
  });

  test('add a user via the picker posts assign and refreshes the table', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/zones/assign/1');
    await waitForViewReady(page, 'zoneAssign');

    await page.locator('#assign_to_zone_btn').click();
    await expect(page.locator('#assign_to_zone_modal[open]')).toBeVisible();

    await pickUser(page, '#assign_to_zone_autocomplete', 'user3', 'Baz [user3]');
    await expect(page.locator('#assign_to_zone_table .tabulator-row')).toHaveCount(1);

    const assignResp = page.waitForResponse(
      (r) => r.url().includes('/xhr/zones/assign') && r.request().method() === 'POST');
    await page.locator('#assign_to_zone_modal_addbtn').click();
    await expect((await assignResp).status()).toBe(200);

    // members table reloads after add -> user3 now listed
    await expect(page.locator('#zone_assignees_table .tabulator-row').filter({ hasText: 'user3' })).toBeVisible();

    const result = await querySql('SELECT zone_role FROM zone_assign WHERE zid = 1 AND login = $1', ['user3']);
    expect(Number(result.rows[0].zone_role)).toBe(20); // default "user" role
  });

  test('remove a member via the row icon posts assign and refreshes the table', async ({ page }) => {
    // sample data: zone 1 has group_1a (role 20) — remove it
    await logIn(page, ADMIN);
    await page.goto('/zones/assign/1');
    await waitForViewReady(page, 'zoneAssign');

    const row = page.locator('#zone_assignees_table .tabulator-row').filter({ hasText: 'group_1a' });
    await row.locator('.warp-icon-danger').click();

    const confirm = page.locator('dialog.modal[open]').filter({ hasText: 'Are you sure' });
    await expect(confirm).toBeVisible();
    const removeResp = page.waitForResponse(
      (r) => r.url().includes('/xhr/zones/assign') && r.request().method() === 'POST');
    await confirm.locator('button', { hasText: 'Yes' }).click();
    await expect((await removeResp).status()).toBe(200);

    await expect(page.locator('#zone_assignees_table .tabulator-row').filter({ hasText: 'group_1a' })).toHaveCount(0);
    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM zone_assign WHERE zid = 1 AND login = $1', ['group_1a']);
    expect(result.rows[0].cnt).toBe(0);
  });
});

test.describe('group assign view', () => {
  test('loads and lists group members', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/groups/assign/group_1a');
    await waitForViewReady(page, 'groupAssign');
    await expect(page.locator('#group_assign_title_text')).toHaveText(/Group 1A/);
    // sample data: groups('group_1a','user2')
    await expect(page.locator('#groupMembersTable .tabulator-row').filter({ hasText: 'user2' })).toBeVisible();
  });

  test('add a member via the picker posts groups/assign and refreshes the table', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/groups/assign/group_1a');
    await waitForViewReady(page, 'groupAssign');

    await page.locator('#add_to_group_btn').click();
    await expect(page.locator('#add_to_group_modal[open]')).toBeVisible();

    await pickUser(page, '#add_to_group_autocomplete', 'user3', 'Baz [user3]');
    await expect(page.locator('#addToGroupTable .tabulator-row')).toHaveCount(1);

    const assignResp = page.waitForResponse(
      (r) => r.url().includes('/xhr/groups/assign') && r.request().method() === 'POST');
    await page.locator('#add_to_group_modal_addbtn').click();
    await expect((await assignResp).status()).toBe(200);

    await expect(page.locator('#groupMembersTable .tabulator-row').filter({ hasText: 'user3' })).toBeVisible();

    // membership stored in groups(group, login)
    const r2 = await querySql('SELECT COUNT(*)::int AS cnt FROM groups WHERE "group" = $1 AND login = $2', ['group_1a', 'user3']);
    expect(r2.rows[0].cnt).toBe(1);
  });

  test('remove a member via the row icon posts groups/assign and refreshes the table', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/groups/assign/group_1a');
    await waitForViewReady(page, 'groupAssign');

    const row = page.locator('#groupMembersTable .tabulator-row').filter({ hasText: 'user2' });
    await row.locator('.warp-icon-danger').click();

    const confirm = page.locator('dialog.modal[open]').filter({ hasText: 'Are you sure' });
    await expect(confirm).toBeVisible();
    const removeResp = page.waitForResponse(
      (r) => r.url().includes('/xhr/groups/assign') && r.request().method() === 'POST');
    await confirm.locator('button', { hasText: 'Yes' }).click();
    await expect((await removeResp).status()).toBe(200);

    await expect(page.locator('#groupMembersTable .tabulator-row').filter({ hasText: 'user2' })).toHaveCount(0);
    const r2 = await querySql('SELECT COUNT(*)::int AS cnt FROM groups WHERE "group" = $1 AND login = $2', ['group_1a', 'user2']);
    expect(r2.rows[0].cnt).toBe(0);
  });
});