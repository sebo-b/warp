import { test, expect } from '../../fixtures';
import { logIn, logOut } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { openUserMenu } from '../../helpers/settings';

test.describe('logout', () => {

  test('Logout link appears in user menu', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await expect(page.locator('#user_menu_dropdown a', { hasText: 'Logout' })).toBeVisible();
  });

  test('clicking Logout redirects to login page', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Logout' }).click();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('after logout, protected pages redirect to login', async ({ page }) => {
    await logIn(page, USER1);
    await logOut(page);
    await page.goto('/bookings');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('after logout, prefs API rejects the old session', async ({ page }) => {
    await logIn(page, USER1);
    await logOut(page);
    const resp = await page.request.get('/xhr/prefs', { maxRedirects: 0 });
    expect([302, 401, 403]).toContain(resp.status());
  });

  test('admin can also log out', async ({ page }) => {
    await logIn(page, ADMIN);
    await logOut(page);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByLabel('Login')).toBeVisible();
  });

});
