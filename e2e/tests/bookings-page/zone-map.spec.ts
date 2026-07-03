import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  getZoneSeats,
  getFirstZoneDate,
  selectOnlyDates,
  clickZoneSeat,
  waitForSeatsLoaded,
  bookSeatUI,
  apiApply,
  futureDayTs,
} from '../../helpers/booking';

test.describe('zone map booking flow (end-to-end)', () => {

  test('booking via zone map appears immediately on bookings page', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
  });

  test('releasing a seat via zone map removes it from the bookings page', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      page.locator('.plan_action_btn[data-action="delete"]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row')).toHaveCount(0);
  });

  test('booking released from bookings page no longer shows on zone map', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();
    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      modal.locator('button.modal-close', { hasText: /yes/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="book"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).not.toBeVisible();
  });

  test('direct API booking shows up on the bookings page', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);

    await logIn(page, USER1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);

    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
  });

});
