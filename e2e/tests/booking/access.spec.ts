import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';

test.describe('zone access', () => {

  test('user1 (direct admin assignment) can open Zone 1A', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/zone/1');
    await expect(page.locator('#zonemap')).toBeVisible();
  });

  test('user2 (via group_1a) can open Zone 1A', async ({ page }) => {
    await logIn(page, USER2);
    await page.goto('/zone/1');
    await expect(page.locator('#zonemap')).toBeVisible();
  });

  test('user1 (via group_1b) can open Zone 1B', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/zone/2');
    await expect(page.locator('#zonemap')).toBeVisible();
  });

  test('user3 (no assignments) is denied access to every zone', async ({ page }) => {
    await logIn(page, USER3);
    for (const zid of [1, 2, 3]) {
      const resp = await page.request.get(`/zone/${zid}`);
      expect(resp.status(), `zone ${zid}`).toBe(403);
    }
  });

  test('user1 cannot access Parking zone (not assigned)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/zone/3');
    expect(resp.status()).toBe(403);
  });

  test('user2 cannot access Zone 1B (not in group_1b)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await page.request.get('/zone/2');
    expect(resp.status()).toBe(403);
  });

});
