import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { getZoneSeats } from '../../helpers/booking';
import { insertBooking, fillHeaderFilter, clickColumnHeader, clearDefaultUserFilter } from '../../helpers/bookings-page';

test.describe('bookings page filtering', () => {

  test('filtering by seat name shows only matching rows', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id);
    await insertBooking('user2', seats[1].id); // different user avoids zone_group overlap trigger

    await logIn(page, USER1); // zone admin sees both
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);
    await expect(page.locator('.tabulator-row')).toHaveCount(2);

    await fillHeaderFilter(page, 'seat_name', seats[0].name);
    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText(seats[0].name);
  });

  test('filtering by plan name shows only matching rows', async ({ page }) => {
    const zone1Seats = await getZoneSeats(1);
    const zone2Seats = await getZoneSeats(2);
    await insertBooking('user1', zone1Seats[0].id);
    await insertBooking('user1', zone2Seats[0].id, 2); // different day avoids overlap

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row')).toHaveCount(2);

    await fillHeaderFilter(page, 'plan_name', 'Plan 1A');
    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText('Plan 1A');
  });

  test('filtering by user name shows only matching rows (zone admin view)', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id);
    await insertBooking('user2', seats[1].id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);
    await expect(page.locator('.tabulator-row')).toHaveCount(2);

    await fillHeaderFilter(page, 'user_name', 'Bar');
    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText('Bar');
  });

  test('clearing the filter restores all rows', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id);
    await insertBooking('user2', seats[1].id); // different user avoids overlap trigger

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);

    await fillHeaderFilter(page, 'seat_name', seats[0].name);
    await expect(page.locator('.tabulator-row')).toHaveCount(1);

    await fillHeaderFilter(page, 'seat_name', '');
    await expect(page.locator('.tabulator-row')).toHaveCount(2);
  });

  test('filter with no match shows empty table', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await fillHeaderFilter(page, 'seat_name', 'ZZZNOMATCH');
    await expect(page.locator('.tabulator-row')).toHaveCount(0);
  });

});

test.describe('bookings page sorting', () => {

  test('default sort is ascending by date (earliest booking first)', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id, 3); // 3 days out
    await insertBooking('user1', seats[1].id, 1); // 1 day out (should appear first)

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    const rows = page.locator('.tabulator-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText(seats[1].name);
  });

  test('clicking plan_name column header changes row order', async ({ page }) => {
    const zone1Seats = await getZoneSeats(1);
    const zone2Seats = await getZoneSeats(2);
    await insertBooking('user1', zone1Seats[0].id, 1);
    await insertBooking('user1', zone2Seats[0].id, 2); // different day

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await clickColumnHeader(page, 'plan_name'); // sort ascending
    const firstAfterAsc = await page
      .locator('.tabulator-row').first()
      .locator('.tabulator-cell[tabulator-field="plan_name"]')
      .innerText();

    await clickColumnHeader(page, 'plan_name'); // sort descending
    const firstAfterDesc = await page
      .locator('.tabulator-row').first()
      .locator('.tabulator-cell[tabulator-field="plan_name"]')
      .innerText();

    expect(firstAfterAsc).not.toEqual(firstAfterDesc);
  });

  test('sorting by seat_name sorts rows alphabetically', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id, 1);
    await insertBooking('user1', seats[seats.length - 1].id, 2);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await clickColumnHeader(page, 'seat_name'); // sort asc
    const rows = page.locator('.tabulator-row');
    const firstCellText = await rows.first().locator('.tabulator-cell[tabulator-field="seat_name"]').innerText();
    const lastCellText = await rows.last().locator('.tabulator-cell[tabulator-field="seat_name"]').innerText();
    expect(firstCellText.localeCompare(lastCellText)).toBeLessThanOrEqual(0);
  });

});
