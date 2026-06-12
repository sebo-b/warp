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
