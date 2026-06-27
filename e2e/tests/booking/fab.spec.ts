import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  getZoneSeats,
  getFirstZoneDate,
  selectOnlyDates,
  waitForSeatsLoaded,
} from '../../helpers/booking';

test.describe('auto-book FAB', () => {

  test('FAB creates at least one booking when clicked', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const ts = await getFirstZoneDate(page, 1);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    const fab = page.locator('#auto_book_btn');
    await expect(fab).not.toHaveClass(/disabled/);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/autoBook') && r.status() === 200),
      fab.click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1',
      ['user1'],
    );
    expect(result.rows[0].cnt).toBeGreaterThan(0);
  });

  test('FAB is disabled when the selection is already exactly booked', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(600);

    await expect(page.locator('#auto_book_btn')).toHaveClass(/disabled/);
  });

  test('FAB is disabled when no dates are selected', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    // Deselect every currently-selected day (click toggles; no clear-link).
    // No dates selected => FAB disabled.
    while (await page.locator('.warp-cal-day.is-selected').count()) {
      await page.locator('.warp-cal-day.is-selected').first().click();
    }
    await page.waitForTimeout(400);

    await expect(page.locator('#auto_book_btn')).toHaveClass(/disabled/);
  });

});
