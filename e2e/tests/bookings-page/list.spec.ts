/**
 * My Bookings page — list visibility and deleting bookings.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats } from '../../helpers/booking';
import { insertBooking, clearDefaultUserFilter } from '../../helpers/bookings-page';

test.describe('bookings list visibility', () => {

  test('bookings page loads the Tabulator table', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#reportTable')).toBeVisible();
    await expect(page.locator('.tabulator-col[tabulator-field="seat_name"]')).toBeVisible();
  });

  test("user's own upcoming booking appears in the list", async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
  });

  test('past bookings are not shown (only future/today bookings visible)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, yesterday + 9 * 3600, yesterday + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row')).toHaveCount(0);
  });

  test('user sees all bookings in their accessible zones (not only their own)', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id);
    await insertBooking('user2', seats[1].id);

    await logIn(page, USER2);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);
    await expect(page.locator('.tabulator-row')).toHaveCount(2);
  });

  test("another user's bookings in zones the user cannot access are NOT shown", async ({ page }) => {
    // user2 has no access to zone 2; user1's booking there is foreign to
    // user2 → stays hidden (the own-booking disjunct only admits own rows).
    const zone2Seats = await getZoneSeats(2);
    await insertBooking('user1', zone2Seats[0].id);

    await logIn(page, USER2);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row')).toHaveCount(0);
  });

  test('own booking in a zone the user has no access to IS shown and deletable', async ({ page }) => {
    // user3 has no zone_assign at all → no access to enabled zone 2. But they
    // hold a booking there (e.g. access was revoked after booking, or an
    // admin booked them in then removed their role). The plan map can't reach
    // a seat in a zone they can't open, so the bookings table is the only UI
    // path to release it: the row must be visible and the delete icon shown.
    const zone2Seats = await getZoneSeats(2);
    const bid = await insertBooking('user3', zone2Seats[0].id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText(zone2Seats[0].name);
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toBeVisible();

    // And the release actually works end-to-end.
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();
    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await expect(modal).toBeVisible();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      modal.locator('button.modal-close', { hasText: /yes/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tabulator-row')).toHaveCount(0);
    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1', [bid]);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('delete icon is present for own bookings (rw=true)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toBeVisible();
  });

  test('delete icon is absent for another user booking seen by a regular user', async ({ page }) => {
    const seats = await getZoneSeats(1);
    await insertBooking('user1', seats[0].id);
    await insertBooking('user2', seats[1].id);

    await logIn(page, USER2);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);

    const user1Row = page.locator('.tabulator-row', { hasText: 'Foo' });
    await expect(user1Row.locator('.material-icons.warp-icon-danger')).toHaveCount(0);
  });

  test('zone admin sees delete icon on other users bookings in their zone', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user2', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toBeVisible();
  });

});

test.describe('delete booking from the bookings page', () => {

  test('clicking delete icon opens a confirmation modal', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();

    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();
    await expect(page.locator('.modal', { hasText: 'Are you sure to release this booking?' })).toBeVisible();
  });

  test('confirmation modal shows booking details', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();

    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await expect(modal).toContainText(seat.name);
    await expect(modal).toContainText('Plan 1A');
  });

  test('confirming delete removes the booking from the table and the DB', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const bid = await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();

    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await expect(modal).toBeVisible();
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      modal.locator('button.modal-close', { hasText: /yes/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    await expect(page.locator('.tabulator-row')).toHaveCount(0);
    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1', [bid]);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('cancelling delete (No) keeps the booking', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const bid = await insertBooking('user1', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();

    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await expect(modal).toBeVisible();
    await modal.locator('button.modal-close', { hasText: /no/i }).click();
    await page.waitForTimeout(300);

    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1', [bid]);
    expect(result.rows[0].cnt).toBe(1);
  });

  test('zone admin can delete another user booking from the list', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const bid = await insertBooking('user2', seat.id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);
    await page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger').click();

    const modal = page.locator('.modal', { hasText: 'Are you sure to release this booking?' });
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      modal.locator('button.modal-close', { hasText: /yes/i }).click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1', [bid]);
    expect(result.rows[0].cnt).toBe(0);
  });

});
