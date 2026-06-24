/**
 * Bookings page "User name" header filter:
 *   - defaults to the logged-in user's own bookings via an EXACT login match
 *     (the box is pre-filled with their name);
 *   - ANY edit flips it to the regular starts-with name filter;
 *   - clearing the box = empty name filter = show everyone.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { getZoneSeats, futureDayTs } from '../../helpers/booking';
import { fillHeaderFilter } from '../../helpers/bookings-page';

test.describe('bookings page name filter', () => {
  test('defaults to my bookings, flips to starts-with on any edit', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const ts = futureDayTs(1);
    // Two future bookings in the shared Zone 1 by two different users.
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1,$2,$3,$4), ($5,$6,$3,$4)',
      [USER1.login, seats[0].id, ts + 9 * 3600, ts + 17 * 3600,
       USER2.login, seats[1].id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    const nameInput = page.locator(
      '.tabulator-col[tabulator-field="user_name"] .tabulator-header-filter input',
    );
    const row = (i: number) =>
      page.locator('.tabulator-row', { hasText: seats[i].name });

    // Default: box shows the user's name; filter is exact-login -> only my booking.
    await expect(nameInput).toHaveValue(USER1.name);
    await expect(row(0)).toBeVisible();
    await expect(row(1)).toHaveCount(0);

    // Typing "B" flips to starts-with on the visible name: matches user2
    // ("Bar"), not user1 ("Foo").
    await fillHeaderFilter(page, 'user_name', 'B');
    await expect(row(1)).toBeVisible();
    await expect(row(0)).toHaveCount(0);

    // Clearing flips to the regular empty filter = show everyone.
    await fillHeaderFilter(page, 'user_name', '');
    await expect(row(0)).toBeVisible();
    await expect(row(1)).toBeVisible();
  });
});