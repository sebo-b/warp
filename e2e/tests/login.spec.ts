import { test, expect } from '../fixtures';
import { logIn, expectLoggedIn, logOut } from '../helpers/auth';
import { ADMIN, USER1 } from '../helpers/users';

test.describe('login', () => {

  test('admin can log in', async ({ page }) => {
    await logIn(page, ADMIN);
    await expectLoggedIn(page);
  });

  test('regular user can log in', async ({ page }) => {
    await logIn(page, USER1);
    await expectLoggedIn(page);
  });

  test('wrong password shows an error and stays on login page', async ({ page }) => {
    await logIn(page, { ...ADMIN, password: 'wrong-password' });
    await expect(page.locator('.flash_message')).toHaveText('Wrong username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('user can log out', async ({ page }) => {
    await logIn(page, ADMIN);
    await expectLoggedIn(page);
    await logOut(page);
    await expect(page.getByLabel('Login')).toBeVisible();
  });

  test('logged-out user is redirected to login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

});

// LOGIN_IGNORECASE defaults to true, so a login entered in any letter case
// resolves to the single stored account (see GitHub issue #48).
test.describe('case-insensitive login', () => {

  test('admin can log in with a different letter case', async ({ page }) => {
    await logIn(page, { ...ADMIN, login: 'ADMIN' });
    await expectLoggedIn(page);
    // Resolved to the real admin account: an admin-only page is accessible.
    const resp = await page.request.get('/users');
    expect(resp.status()).toBe(200);
  });

  test('regular user can log in with a different letter case', async ({ page }) => {
    await logIn(page, { ...USER1, login: 'User1' });
    await expectLoggedIn(page);
    // Resolved to a regular account, not elevated to admin.
    const resp = await page.request.get('/users');
    expect(resp.status()).toBe(403);
  });

  test('a different-case login still rejects a wrong password', async ({ page }) => {
    await logIn(page, { ...ADMIN, login: 'Admin', password: 'wrong-password' });
    await expect(page.locator('.flash_message')).toHaveText('Wrong username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

});
