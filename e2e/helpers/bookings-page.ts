import type { Page } from '@playwright/test';
import { querySql } from './db';
import { futureDayTs } from './booking';

/** Insert a booking directly into the DB and return its id. */
export async function insertBooking(
  login: string,
  sid: number,
  dayOffset = 1,
): Promise<number> {
  const ts = futureDayTs(dayOffset);
  await querySql(
    'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
    [login, sid, ts + 9 * 3600, ts + 17 * 3600],
  );
  const r = await querySql(
    'SELECT id FROM book WHERE login = $1 AND sid = $2 AND fromts = $3',
    [login, sid, ts + 9 * 3600],
  );
  return Number(r.rows[0].id);
}

/**
 * Fill the header-filter input for a given Tabulator field and wait for the
 * debounced remote filter POST to complete.
 * Uses pressSequentially to fire proper key events that Tabulator's filter
 * handler listens for (fill() alone doesn't trigger Tabulator's debounce).
 */
export async function fillHeaderFilter(
  page: Page,
  field: string,
  value: string,
): Promise<void> {
  const input = page.locator(
    `.tabulator-col[tabulator-field="${field}"] .tabulator-header-filter input`,
  );
  await input.click();
  if (value) {
    // Select-all is OS-specific in Playwright, so clear first and type fresh.
    await input.fill('');
    await input.pressSequentially(value, { delay: 30 });
  } else {
    // Clear via fill + an explicit input event to wake up custom editors.
    await input.fill('');
    await input.dispatchEvent('input');
  }
  // Wait for Tabulator's filter debounce to fire the remote request
  await page.waitForTimeout(400);
  await page.waitForLoadState('networkidle');
}

/**
 * The bookings page defaults the "User name" header filter to the logged-in
 * user's own login, so it initially shows only their own bookings. Call this
 * after navigating to /bookings when a test needs to see bookings from other
 * users.
 */
export async function clearDefaultUserFilter(page: Page): Promise<void> {
  await fillHeaderFilter(page, 'user_name', '');
}

/** Click a Tabulator column header to toggle sort and wait for the remote sort POST. */
export async function clickColumnHeader(
  page: Page,
  field: string,
): Promise<void> {
  const responsePromise = page.waitForResponse(
    r => r.url().includes('/xhr/bookings/list') && r.status() === 200,
  );
  await page.locator(`.tabulator-col[tabulator-field="${field}"] .tabulator-col-title`).click();
  await responsePromise;
}
