import type { Page, APIResponse } from '@playwright/test';
import { expect } from '@playwright/test';

/** Open the desktop user-menu dropdown (the person icon). */
export async function openUserMenu(page: Page): Promise<void> {
  await page.locator('.dropdown-trigger[data-target="user_menu_dropdown"]').click();
  await expect(page.locator('#user_menu_dropdown')).toBeVisible();
}

/** Open the Calendar integration modal via the desktop user menu.
 *  Must be called while logged in (top nav present).
 *  Scopes the link to the freshly opened #user_menu_dropdown to avoid
 *  the duplicate copy that also exists inside the mobile sidenav.
 *
 *  After open, scroll the modal content to the top so that form controls
 *  near the top are inside the viewport (Materialize modal + small harness viewport).
 */
export async function openCalendarModal(page: Page): Promise<void> {
  await openUserMenu(page);
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /calendar integration/i }).click();
  const modal = page.locator('#calendar_modal');
  await expect(modal).toBeVisible();
  // Ensure inner content is scrolled to top; some controls are otherwise "outside viewport".
  await modal.locator('.modal-content').evaluate((el: HTMLElement) => { el.scrollTop = 0; });
}

/** Full prefs payload matching the required schema. */
export const defaultPrefsPayload = {
  default_day: 'same',
  default_time: [9 * 3600, 17 * 3600],
  zone_show_seat_names: false,
  zone_show_booking_preview: false,
};

/** POST to /xhr/prefs with the given overrides, return the response. */
export async function apiSetPrefs(
  page: Page,
  overrides: object,
): Promise<APIResponse> {
  return page.request.post('/xhr/prefs', {
    data: { ...defaultPrefsPayload, ...overrides },
    headers: { 'Content-Type': 'application/json' },
  });
}

/** POST to /change_password (auth blueprint has no URL prefix). */
export async function apiChangePassword(
  page: Page,
  oldPassword: string,
  newPassword: string,
): Promise<APIResponse> {
  return page.request.post('/change_password', {
    data: { old_password: oldPassword, new_password: newPassword },
    headers: { 'Content-Type': 'application/json' },
  });
}
