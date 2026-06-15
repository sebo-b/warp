import { test, expect } from '../../fixtures';
import { logIn, logOut } from '../../helpers/auth';
import { USER1, USER2 } from '../../helpers/users';
import {
  openUserMenu,
  defaultPrefsPayload,
  apiSetPrefs,
} from '../../helpers/settings';

test.describe('preferences modal', () => {

  test('Preferences entry appears in the user menu', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await expect(page.locator('#user_menu_dropdown a', { hasText: 'Preferences' })).toBeVisible();
  });

  test('clicking Preferences opens the preferences modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Preferences' }).click();
    await expect(page.locator('#pref_modal')).toBeVisible();
  });

  test('pref modal contains expected controls', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Preferences' }).click();
    await expect(page.locator('#pref_modal')).toBeVisible();

    await expect(page.locator('#pref_default_plan')).toBeAttached();
    await expect(page.locator('#pref_default_day')).toBeAttached();
    await expect(page.locator('#pref_zone_show_seat_names')).toBeAttached();
    await expect(page.locator('#pref_zone_show_booking_preview')).toBeAttached();
    await expect(page.locator('#pref_save_btn')).toBeVisible();
  });

  test('toggling Show seat names and saving shows a success toast', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/');
    await openUserMenu(page);
    await page.locator('#user_menu_dropdown a', { hasText: 'Preferences' }).click();
    await expect(page.locator('#pref_modal')).toBeVisible();

    await page.waitForTimeout(400);
    // Click the Materialize toggle lever (clicking the lever fires the change event correctly)
    const lever = page.locator('label:has(#pref_zone_show_seat_names) .lever');
    await lever.scrollIntoViewIfNeeded();
    await lever.click();
    await page.locator('#pref_save_btn').click();

    await expect(page.locator('.toast', { hasText: 'Preferences saved' })).toBeVisible();
  });

  test('saved preferences persist across page loads (via API)', async ({ page }) => {
    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_seat_names: true, default_day: 'tomorrow' });

    const resp = await page.request.get('/xhr/prefs');
    expect(resp.status()).toBe(200);
    const prefs = await resp.json();
    expect(prefs.zone_show_seat_names).toBe(true);
    expect(prefs.default_day).toBe('tomorrow');
  });

  test('each user has independent preferences', async ({ page }) => {
    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_seat_names: true });
    await logOut(page);

    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/prefs');
    const prefs = await resp.json();
    expect(prefs.zone_show_seat_names).toBe(false);
  });

});

test.describe('preferences API', () => {

  test('GET /xhr/prefs returns defaults for a user with no saved prefs', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/prefs');
    expect(resp.status()).toBe(200);
    const prefs = await resp.json();
    expect(prefs).toMatchObject({
      default_day: 'same',
      default_time: [9 * 3600, 17 * 3600],
      zone_show_seat_names: false,
      zone_show_booking_preview: false,
    });
  });

  test('POST /xhr/prefs saves and echoes back the new prefs', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiSetPrefs(page, {
      default_day: 'tomorrow',
      default_time: [8 * 3600, 18 * 3600],
      zone_show_seat_names: true,
      zone_show_booking_preview: true,
    });
    expect(resp.status()).toBe(200);
    const prefs = await resp.json();
    expect(prefs.default_day).toBe('tomorrow');
    expect(prefs.default_time).toEqual([8 * 3600, 18 * 3600]);
    expect(prefs.zone_show_seat_names).toBe(true);
    expect(prefs.zone_show_booking_preview).toBe(true);
  });

  test('POST /xhr/prefs rejects time_from >= time_to with code 13', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiSetPrefs(page, { default_time: [17 * 3600, 9 * 3600] });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(13);
  });

  test('POST /xhr/prefs rejects equal time_from and time_to', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiSetPrefs(page, { default_time: [9 * 3600, 9 * 3600] });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(13);
  });

  test('POST /xhr/prefs rejects unknown default_day value', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiSetPrefs(page, { default_day: 'never' });
    expect(resp.status()).toBe(400);
  });

  test('GET /xhr/prefs requires authentication', async ({ page }) => {
    const resp = await page.request.get('/xhr/prefs', { maxRedirects: 0 });
    expect([302, 401, 403]).toContain(resp.status());
  });

  test('POST /xhr/prefs requires authentication', async ({ page }) => {
    const resp = await page.request.post('/xhr/prefs', {
      data: defaultPrefsPayload,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
    expect([302, 401, 403]).toContain(resp.status());
  });

  test('saving default_plan updates the preferred landing plan', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await apiSetPrefs(page, { default_plan: 1 });
    expect(resp.status()).toBe(200);
    expect((await resp.json()).default_plan).toBe(1);
  });

});
