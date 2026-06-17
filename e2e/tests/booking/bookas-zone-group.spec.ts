/**
 * Book-as interaction with zone-group / multi-plan booking.
 *
 * These cover the bugs fixed alongside the unified zone-group conflict query:
 *
 *  - Book-as used to fetch only conflict seats (getSeats?onlyOtherZone=1). That
 *    partial response also returned the target's bookings in *accessible* zones
 *    that happened to share a conflict zone-group with the viewed plan, and the
 *    client overwrote those live (rendered) seats with div-less "other zone"
 *    ghosts — leaving the original sprite frozen on its stale TAKEN (padlock)
 *    icon. Book-as now does a full getSeats?login=target refresh, so the
 *    target's own bookings in accessible zones stay recognisable as theirs.
 *
 *  - `bookable` in getSeats now reflects the *target* user's role under book-as,
 *    so a seat the target can only view (VIEWER zone) is no longer offered as
 *    bookable to the admin (which apply() would then reject with 104).
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { adminPost } from '../../helpers/admin';
import {
  futureDayTs,
  getZoneSeats,
  clickZoneSeat,
  selectOnlyDates,
  clickActionBtn,
  waitForSeatsLoaded,
  apiApply,
} from '../../helpers/booking';

/** Activate book-as for the given display label (e.g. "Bar [user2]"). */
async function activateBookAs(page: any, label: string): Promise<void> {
  const bookAsInput = page.locator('#book-as');
  await bookAsInput.click();
  await bookAsInput.pressSequentially(label.split(' ')[0], { delay: 50 });
  const item = page.locator('ul.autocomplete-content li', { hasText: label });
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  // book-as fires a full getSeats?login= refresh; wait for it to settle.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

test.describe('book-as + zone group', () => {

  test('target\'s own booking in an accessible same-group zone shows as deletable, not a padlock', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    // Zone 1A and Zone 1B share a group; user1 administers both, user2 can book 1B.
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 2)");
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER2.login, role: 20 }] });

    // user2 books a seat in Zone 1B (the zone user1 will be viewing).
    await logIn(page, USER2);
    const resp = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp.status()).toBe(200);

    // user1 opens plan 2 (Zone 1B, accessible) and books-as user2.
    await logIn(page, USER1);
    await page.goto('/plan/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await activateBookAs(page, 'Bar [user2]');

    // The seat user2 already holds must be recognised as user2's own booking
    // (delete offered), not shown as taken-by-someone-else (padlock → admin-only
    // actions, no delete).
    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="delete"]')).toBeVisible();
  });

  test('rebooking across a same-group zone via book-as leaves consistent state after refresh', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    // Both zones in the same group, both on plan 1 (mixed plan).
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 2)");
    await querySql('UPDATE seat SET pid = 1 WHERE id = $1', [zone2Seat.id]);

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER2.login, role: 20 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER2.login, role: 20 }] });

    // user2 holds a seat in Zone 1A.
    await logIn(page, USER2);
    expect((await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } })).status()).toBe(200);

    // user1 opens the mixed plan and books-as user2.
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await activateBookAs(page, 'Bar [user2]');

    // Zone 1B seat is same-group → rebook (update), moving user2's booking.
    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="update"]')).toBeVisible();
    await clickActionBtn(page, 'update');

    // Exactly one booking remains, now on Zone 1B, still owned by user2.
    const rows = await querySql('SELECT sid, login FROM book WHERE login = $1', [USER2.login]);
    expect(rows.rowCount).toBe(1);
    expect(Number(rows.rows[0].sid)).toBe(zone2Seat.id);

    // After the post-booking refresh the UI stays consistent: the now-free
    // Zone 1A seat shows rebook (same-group conflict with user2's Zone 1B
    // booking), and the booked Zone 1B seat is deletable.
    await clickZoneSeat(page, zone1Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="update"]')).toBeVisible();
    await expect(page.locator('.zone_action_btn[data-action="book"]')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="delete"]')).toBeVisible();
  });

  test('book-as a viewer-only user marks the seat not bookable (Fix 5)', async ({ page }) => {
    const ts = futureDayTs(1);
    // Zone 3 (Parking): user2 has no group role here, so a direct VIEWER role
    // is genuinely viewer-only (zone 1 would be polluted by group_1a's USER role).
    const parkingSeat = (await getZoneSeats(3))[0];

    // user1 administers Parking; user2 is only a VIEWER there.
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 3, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 3, change: [{ login: USER2.login, role: 30 }] });

    await logIn(page, USER1);
    await page.goto('/plan/3');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // Sanity: as themselves (admin), the seat is bookable.
    await clickZoneSeat(page, parkingSeat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="book"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Book-as user2 (viewer): the seat is now view-only for user2, so clicking
    // it must not open the booking modal (VIEW_ONLY short-circuits the handler).
    await activateBookAs(page, 'Bar [user2]');
    await clickZoneSeat(page, parkingSeat);
    await page.waitForTimeout(300);
    await expect(page.locator('#action_modal')).not.toHaveClass(/open/);
  });

});
