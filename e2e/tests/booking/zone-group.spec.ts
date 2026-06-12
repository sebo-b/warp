/**
 * Zone-group booking semantics (FEATURES.md §3.4, §7.3, §7.6).
 *
 * Zone 1A (zid 1) and Zone 1B (zid 2) share the Default zone group; Parking
 * (zid 3) has its own group. A user can hold only one booking at a time
 * within a zone group: booking in a sibling zone auto-replaces the old
 * booking, while a desk and a parking spot can be held simultaneously.
 * The same rule is enforced at the DB level by book_overlap_insert_trig.
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { adminPost } from '../../helpers/admin';
import {
  futureDayTs,
  getZoneSeats,
  bookSeatUI,
  selectOnlyDates,
  clickZoneSeat,
  clickActionBtn,
  waitForSeatsLoaded,
} from '../../helpers/booking';

test.describe('zone-group booking conflicts', () => {

  test('booking in a sibling zone of the same group replaces the old booking', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await logIn(page, USER1);
    await bookSeatUI(page, 1, zone1Seat, [ts]);

    // Same date/time in Zone 1B: the seat is in the rebook state (the action
    // modal offers Update) and confirming replaces the Zone 1A booking.
    await page.goto('/zone/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'update');

    const rows = await querySql(
      'SELECT sid FROM book WHERE login = $1 ORDER BY id', [USER1.login]);
    expect(rows.rowCount).toBe(1);
    expect(Number(rows.rows[0].sid)).toBe(zone2Seat.id);
  });

  test('action modal lists the conflicting booking to be removed', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await logIn(page, USER1);
    await bookSeatUI(page, 1, zone1Seat, [ts]);

    await page.goto('/zone/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    // The "To be removed:" section lists the conflicting Zone 1A booking.
    const removeSection = page.locator('#action_modal_msg2');
    await expect(removeSection).toContainText('To be removed:');
    await expect(removeSection).toContainText('Zone 1A');
    await expect(removeSection).toContainText(zone1Seat.name);
  });

  test('a desk and a parking spot (different zone groups) can be held at the same time', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const parkingSeat = (await getZoneSeats(3))[0];

    // Give user1 access to the Parking zone first.
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 3,
      change: [{ login: USER1.login, role: 20 }],
    });
    expect(resp.status()).toBe(200);

    await logIn(page, USER1);
    await bookSeatUI(page, 1, zone1Seat, [ts]);
    await bookSeatUI(page, 3, parkingSeat, [ts]);

    const rows = await querySql(
      'SELECT sid FROM book WHERE login = $1 ORDER BY sid', [USER1.login]);
    expect(rows.rowCount).toBe(2);
    expect(rows.rows.map((r: any) => Number(r.sid)).sort((a: number, b: number) => a - b))
      .toEqual([zone1Seat.id, parkingSeat.id].sort((a, b) => a - b));
  });

  test('DB trigger rejects overlapping bookings across zones of the same group', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seat.id, ts + 9 * 3600, ts + 17 * 3600]);

    await expect(querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone2Seat.id, ts + 10 * 3600, ts + 12 * 3600],
    )).rejects.toThrow();
  });

  test('DB trigger allows overlapping bookings in different zone groups', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const parkingSeat = (await getZoneSeats(3))[0];

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seat.id, ts + 9 * 3600, ts + 17 * 3600]);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, parkingSeat.id, ts + 9 * 3600, ts + 17 * 3600]);

    const rows = await querySql(
      'SELECT id FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(2);
  });
});
