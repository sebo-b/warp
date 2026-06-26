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
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
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

/** Clear book-as (Enter on an empty input resets to the admin's own login). */
async function clearBookAs(page: any): Promise<void> {
  const bookAsInput = page.locator('#book-as');
  await bookAsInput.click();
  await bookAsInput.fill('');
  await bookAsInput.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

/** Open the action modal for a seat and return the set of visible action labels. */
async function seatActions(page: any, seat: any): Promise<string[]> {
  await clickZoneSeat(page, seat);
  const modal = page.locator('#action_modal');
  // VIEW_ONLY / NOT_AVAILABLE short-circuit the handler: the modal never opens.
  try {
    await expect(modal).toHaveClass(/open/, { timeout: 1500 });
  } catch {
    return [];
  }
  const actions: string[] = [];
  for (const a of ['book', 'update', 'delete', 'enable', 'disable']) {
    if (await page.locator(`.plan_action_btn[data-action="${a}"]`).isVisible())
      actions.push(a);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  return actions;
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
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
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
    await expect(page.locator('.plan_action_btn[data-action="update"]')).toBeVisible();
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
    await expect(page.locator('.plan_action_btn[data-action="update"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="book"]')).not.toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
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
    await expect(page.locator('.plan_action_btn[data-action="book"]')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    // Book-as user2 (viewer): the seat is now view-only for user2, so clicking
    // it must not open the booking modal (VIEW_ONLY short-circuits the handler).
    await activateBookAs(page, 'Bar [user2]');
    await clickZoneSeat(page, parkingSeat);
    await page.waitForTimeout(300);
    await expect(page.locator('#action_modal')).not.toHaveClass(/open/);
  });

  test('GUARD: getSeats sends login on book-as conflict seats (Fix 1 server contract)', async ({ page }) => {
    // Deterministic contract guard. The target's only booking is in a zone the
    // admin cannot access, so it reaches the response purely via the conflict
    // query (an other-zone seat: no x/y). Fix 1 requires that conflict booking
    // to carry its owner login explicitly, so the client (Fix 2) never has to
    // infer it from factory.login. If the server stopped sending login this
    // assertion fails directly on the JSON.
    //
    // Zone 3 (Parking) is the inaccessible zone: user1 has no role there
    // (group_parking has no members), unlike Zone 1B where user1 is in group_1b.
    const ts = futureDayTs(1);
    const parkingSeat = (await getZoneSeats(3))[0];
    const fromTS = ts + 9 * 3600, toTS = ts + 17 * 3600;

    // Zone 1A and Parking share a group; move the Parking seat onto plan 1.
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 3)");
    await querySql('UPDATE seat SET pid = 1 WHERE id = $1', [parkingSeat.id]);
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER1.login, role: 10 }] });
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER2.login, parkingSeat.id, fromTS, toTS]);

    await logIn(page, USER1);
    const resp = await page.request.get(`/xhr/zone/getSeats/1?login=${USER2.login}`, { maxRedirects: 0 });
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    const conflictSeat = body.seats[String(parkingSeat.id)];

    // Surfaced as a conflict-only (other-zone) seat: no coordinates.
    expect(conflictSeat).toBeTruthy();
    expect(conflictSeat.x).toBeUndefined();
    expect(conflictSeat.y).toBeUndefined();
    // The contract: the conflict booking carries the owner login explicitly.
    expect(conflictSeat.book.length).toBeGreaterThan(0);
    expect(conflictSeat.book[0].login).toBe(USER2.login);
  });

  test('book-as conflict seat in an inaccessible same-group zone drives rebook (client uses server login)', async ({ page }) => {
    // UI counterpart of the contract guard: the inaccessible Parking booking
    // must make the accessible Zone 1A seat a rebook under book-as. This passes
    // only if the conflict seat is recognised as the target's, i.e. its login
    // arrived from the server and the client honoured it.
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const parkingSeat = (await getZoneSeats(3))[0];
    const fromTS = ts + 9 * 3600, toTS = ts + 17 * 3600;

    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 3)");
    await querySql('UPDATE seat SET pid = 1 WHERE id = $1', [parkingSeat.id]);
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER1.login, role: 10 }] });
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER2.login, parkingSeat.id, fromTS, toTS]);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await activateBookAs(page, 'Bar [user2]');

    await clickZoneSeat(page, zone1Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="update"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="book"]')).not.toBeVisible();
    // The conflicting Parking booking is listed for removal (built by
    // getMyConflictingBookings, which matches on the acting login).
    await expect(page.locator('#action_modal_msg2')).toContainText('Parking');
  });

});

test.describe('book-as target switching', () => {

  // Helper: zones 1 & 2 share group 'floor-1'; user1 admins both; the given
  // users get USER access to Zone 1B (zid 2). Returns the two seats of interest.
  async function setupGroup(page: any, extraUsers: string[] = []) {
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 2)");
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 1, change: [{ login: USER1.login, role: 10 }] });
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 10 }] });
    for (const u of [USER2.login, ...extraUsers])
      await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: u, role: 20 }] });
    return { zone1Seat, zone2Seat };
  }

  test('switching book-as back to self restores the admin\'s own (conflict-free) view', async ({ page }) => {
    const ts = futureDayTs(1);
    const { zone1Seat, zone2Seat } = await setupGroup(page);
    const fromTS = ts + 9 * 3600, toTS = ts + 17 * 3600;

    // user2 holds a Zone 1A seat (same group as the Zone 1B we'll view).
    await logIn(page, USER2);
    expect((await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } })).status()).toBe(200);

    await logIn(page, USER1);
    await page.goto('/plan/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // As user2: Zone 1B seat is a rebook (user2's same-group Zone 1A booking).
    await activateBookAs(page, 'Bar [user2]');
    expect(await seatActions(page, zone2Seat)).toContain('update');
    expect(await seatActions(page, zone2Seat)).not.toContain('book');

    // Back to self (admin user1, who holds nothing): plain book, no rebook.
    await clearBookAs(page);
    const selfActions = await seatActions(page, zone2Seat);
    expect(selfActions).toContain('book');
    expect(selfActions).not.toContain('update');
  });

  test('switching book-as between two targets reflects each target\'s own conflicts', async ({ page }) => {
    const ts = futureDayTs(1);
    const { zone1Seat, zone2Seat } = await setupGroup(page, [USER3.login]);
    const fromTS = ts + 9 * 3600, toTS = ts + 17 * 3600;

    // Only user2 has a same-group booking; user3 has none.
    await logIn(page, USER2);
    expect((await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } })).status()).toBe(200);

    await logIn(page, USER1);
    await page.goto('/plan/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // user2 → rebook (has conflict); user3 → plain book (no conflict).
    await activateBookAs(page, 'Bar [user2]');
    expect(await seatActions(page, zone2Seat)).toContain('update');

    await activateBookAs(page, 'Baz [user3]');
    const u3 = await seatActions(page, zone2Seat);
    expect(u3).toContain('book');
    expect(u3).not.toContain('update');

    // Back to user2 → rebook again (no stale ghost from the user3 view).
    await activateBookAs(page, 'Bar [user2]');
    expect(await seatActions(page, zone2Seat)).toContain('update');
  });

});
