/**
 * Bookings page — public zone visibility regression tests.
 *
 * These tests verify that the /bookings list page correctly shows bookings in
 * PUBLIC_VIEW and PUBLIC_BOOK zones for users who have NO explicit zone_assign
 * entry. This was previously broken because the query used an INNER JOIN on
 * user_to_zone_roles, which silently dropped all bookings in public zones for
 * such users.
 *
 * Zone types (from warp/db.py):
 *   ZONE_TYPE_DISABLED    = 10
 *   ZONE_TYPE_ENABLED     = 20
 *   ZONE_TYPE_PUBLIC_VIEW = 30
 *   ZONE_TYPE_PUBLIC_BOOK = 40
 *
 * Zone roles:
 *   ZONE_ROLE_ADMIN  = 10
 *   ZONE_ROLE_USER   = 20
 *   ZONE_ROLE_VIEWER = 30
 *
 * Sample-data zone assignments (warp/sql/sample_data.sql):
 *   zone 1: user1 (admin), group_1a→user2 (user)
 *   zone 2: group_1b→user1 (user)
 *   zone 3: group_parking (viewer)
 *   user3: NO zone_assign entries at all
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER3 } from '../../helpers/users';
import { getZoneSeats } from '../../helpers/booking';
import { insertBooking, clearDefaultUserFilter } from '../../helpers/bookings-page';
import { setZoneType } from '../../helpers/zone-setup';

const ZONE_TYPE_DISABLED = 10;
const ZONE_TYPE_PUBLIC_VIEW = 30;
const ZONE_TYPE_PUBLIC_BOOK = 40;

test.describe('bookings page — public zone visibility', () => {

  test('PUBLIC_BOOK: unassigned user sees own booking and can delete (rw=true)', async ({ page }) => {
    await setZoneType(1, ZONE_TYPE_PUBLIC_BOOK);

    const [seat] = await getZoneSeats(1);
    await insertBooking('user3', seat.id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
    // PUBLIC_BOOK grants USER → rw=true → delete icon visible
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toBeVisible();
  });

  test('PUBLIC_VIEW: unassigned user sees own booking but cannot delete (rw=false)', async ({ page }) => {
    await setZoneType(1, ZONE_TYPE_PUBLIC_VIEW);

    const [seat] = await getZoneSeats(1);
    await insertBooking('user3', seat.id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
    // PUBLIC_VIEW grants VIEWER only → rw=false → no delete icon
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toHaveCount(0);
  });

  test('PUBLIC_BOOK: unassigned user sees another user booking but cannot delete (rw=false)', async ({ page }) => {
    await setZoneType(1, ZONE_TYPE_PUBLIC_BOOK);

    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await clearDefaultUserFilter(page);

    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    // Not own booking → rw=false even though PUBLIC_BOOK grants USER
    await expect(
      page.locator('.tabulator-row').first().locator('.material-icons.warp-icon-danger'),
    ).toHaveCount(0);
  });

  test('DISABLED: unassigned user sees no bookings in disabled zone', async ({ page }) => {
    await setZoneType(1, ZONE_TYPE_DISABLED);

    const [seat] = await getZoneSeats(1);
    await insertBooking('user1', seat.id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    await expect(page.locator('.tabulator-row')).toHaveCount(0);
  });

  test('mixed PUBLIC_BOOK + ENABLED: only public-zone booking visible to unassigned user', async ({ page }) => {
    // Zone 1 → PUBLIC_BOOK (user3 gets implicit USER access)
    await setZoneType(1, ZONE_TYPE_PUBLIC_BOOK);

    const zone1Seats = await getZoneSeats(1);
    const zone2Seats = await getZoneSeats(2);

    // Booking in public zone 1 (accessible to user3)
    await insertBooking('user3', zone1Seats[0].id);
    // Booking in enabled zone 2 (user3 has NO access — no zone_assign)
    await insertBooking('user1', zone2Seats[0].id);

    await logIn(page, USER3);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    // Only the public-zone booking should be visible
    await expect(page.locator('.tabulator-row')).toHaveCount(1);
    await expect(page.locator('.tabulator-row').first()).toContainText(zone1Seats[0].name);
  });

  test('mixed PUBLIC_BOOK + ENABLED: user with explicit access sees both zones', async ({ page }) => {
    // Zone 1 → PUBLIC_BOOK (user1 has explicit ADMIN)
    await setZoneType(1, ZONE_TYPE_PUBLIC_BOOK);

    const zone1Seats = await getZoneSeats(1);
    const zone2Seats = await getZoneSeats(2);

    // user1: admin of zone 1 (now PUBLIC_BOOK), user of zone 2 (ENABLED, via group_1b)
    await insertBooking('user1', zone1Seats[0].id);
    await insertBooking('user1', zone2Seats[0].id);

    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');

    // Both bookings should be visible
    await expect(page.locator('.tabulator-row')).toHaveCount(2);
  });

});
