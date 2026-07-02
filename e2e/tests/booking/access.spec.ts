import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';
import { waitForViewReady } from '../../helpers/spa';

test.describe('zone access', () => {

  test('user1 (direct admin assignment) can open Zone 1A', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await expect(page.locator('#planmap')).toBeVisible();
  });

  test('user2 (via group_1a) can open Zone 1A', async ({ page }) => {
    await logIn(page, USER2);
    await page.goto('/plan/1');
    await expect(page.locator('#planmap')).toBeVisible();
  });

  test('user1 (via group_1b) can open Zone 1B', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/2');
    await expect(page.locator('#planmap')).toBeVisible();
  });

  // /plan/<pid> itself always 200s now (it just serves the SPA shell); access
  // control for a plan deep link lives in /xhr/plan/getContext/<pid>, which the
  // client calls on mount and renders as the #view-error state on failure.
  test('user3 (no assignments) is denied access to every zone', async ({ page }) => {
    await logIn(page, USER3);
    for (const zid of [1, 2, 3]) {
      const resp = await page.request.get(`/xhr/plan/getContext/${zid}`);
      expect(resp.status(), `zone ${zid}`).toBe(403);
    }
  });

  test('user1 cannot access Parking zone (not assigned)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/plan/getContext/3');
    expect(resp.status()).toBe(403);
  });

  test('user2 cannot access Zone 1B (not in group_1b)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/plan/getContext/2');
    expect(resp.status()).toBe(403);
  });

  // The SPA serves the shell for every /plan/<pid> deep link and renders the
  // client #view-error state when the mount-time /xhr/plan/getContext/<pid> call
  // returns 403/404 (router.js maps the rejection to body[data-view="error"]).
  // This guards the router's mount-error mapping: a regression that swallowed
  // the 403 and half-mounted the plan view with undefined context would leave
  // the suite green while a forbidden deep link saw a broken page.
  test('user3 deep-linking a forbidden plan sees the client error view', async ({ page }) => {
    await logIn(page, USER3);
    await page.goto('/plan/1');
    await waitForViewReady(page, 'error');
    await expect(page.locator('#view-error')).toBeVisible();
  });

});
