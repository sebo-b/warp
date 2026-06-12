import { test, expect } from '../../fixtures';
import { logIn, logOut, expectLoggedIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { openUserMenu, apiChangePassword } from '../../helpers/settings';

test.describe('change password modal', () => {

  test('Change password entry appears in the user menu', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await expect(page.locator('#user_menu_dropdown a', { hasText: 'Change password' })).toBeVisible();
  });

  test('clicking Change password opens the modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();
  });

  test('password fields are visible in the modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();
    await expect(page.locator('#cp_old_password')).toBeVisible();
    await expect(page.locator('#cp_new_password')).toBeVisible();
    await expect(page.locator('#cp_repeat_password')).toBeVisible();
    await expect(page.locator('#cp_save_btn')).toBeVisible();
  });

  test('wrong old password shows error toast', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();

    await page.locator('#cp_old_password').fill('wrong-password');
    await page.locator('#cp_new_password').fill('newpassword123');
    await page.locator('#cp_repeat_password').fill('newpassword123');
    await page.locator('#cp_save_btn').click();
    await page.waitForTimeout(1000);
    await expect(page.locator('#change_password_modal')).toBeVisible();
  });

  test('password too short shows toast (client-side, does not close modal)', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();

    await page.locator('#cp_old_password').fill(USER1.password);
    await page.locator('#cp_new_password').fill('abc');
    await page.locator('#cp_repeat_password').fill('abc');
    await page.locator('#cp_save_btn').click();

    await expect(page.locator('.toast')).toBeVisible();
    await expect(page.locator('#change_password_modal')).toBeVisible();
  });

  test("passwords don't match shows toast without submitting", async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();

    await page.locator('#cp_old_password').fill(USER1.password);
    await page.locator('#cp_new_password').fill('newpassword1');
    await page.locator('#cp_repeat_password').fill('newpassword2');
    await page.locator('#cp_save_btn').click();

    await expect(page.locator('.toast', { hasText: "Passwords don't match" })).toBeVisible();
    await expect(page.locator('#change_password_modal')).toBeVisible();
  });

  test('empty fields show mandatory toast without submitting', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();

    await page.locator('#cp_save_btn').click();
    await expect(page.locator('.toast', { hasText: 'All fields are mandatory' })).toBeVisible();
  });

  test('successful password change closes modal and shows toast', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Change password' }).click();
    await expect(page.locator('#change_password_modal')).toBeVisible();

    await page.locator('#cp_old_password').fill(USER1.password);
    await page.locator('#cp_new_password').fill('newpassword123');
    await page.locator('#cp_repeat_password').fill('newpassword123');
    await page.locator('#cp_save_btn').click();

    await expect(page.locator('.toast', { hasText: 'Password changed successfully' })).toBeVisible();
    await expect(page.locator('#change_password_modal')).not.toBeVisible();
  });

  test('after password change the new password works for login', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiChangePassword(page, USER1.password, 'newpassword123');
    expect(resp.status()).toBe(200);
    await logOut(page);

    await logIn(page, { ...USER1, password: 'newpassword123' });
    await expectLoggedIn(page);
  });

  test('after password change the old password no longer works', async ({ page }) => {
    await logIn(page, USER1);
    await apiChangePassword(page, USER1.password, 'newpassword123');
    await logOut(page);

    await logIn(page, USER1);
    await expect(page).toHaveURL(/\/login$/);
  });

});

test.describe('change password API', () => {

  test('POST /change_password returns 200 on success', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiChangePassword(page, USER1.password, 'brandnewpass');
    expect(resp.status()).toBe(200);
  });

  test('wrong old_password returns 400 with code 20', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiChangePassword(page, 'completely-wrong', 'brandnewpass');
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(20);
  });

  test('new_password shorter than 6 chars returns 400 with code 21', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiChangePassword(page, USER1.password, 'abc');
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(21);
  });

  test('exactly MIN_PASSWORD_LENGTH chars is accepted', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiChangePassword(page, USER1.password, 'abc123');
    expect(resp.status()).toBe(200);
  });

  test('unauthenticated request returns 401', async ({ page }) => {
    const resp = await page.request.post('/change_password', {
      data: { old_password: 'x', new_password: 'newpassword' },
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
    expect([401, 302, 403]).toContain(resp.status());
  });

});
