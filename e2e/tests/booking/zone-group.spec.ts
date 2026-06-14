/**
 * Booking constraints: per-zone (NULL zone_group) and zone-group (non-NULL zone_group).
 *
 * Per-zone (zone_group IS NULL):
 *   One seat per zone per time slot. Zone 1A and Zone 1B can be held simultaneously.
 *
 * Zone-group (zone_group IS NOT NULL):
 *   When two zones share the same zone_group text, a user may hold at most one seat
 *   across all zones in that group at any given time.
 *
 * The DB trigger book_overlap_insert_trig enforces both modes.
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
  apiApply,
} from '../../helpers/booking';

test.describe('per-zone booking constraint', () => {

  test('booking in Zone 1A and Zone 1B simultaneously is allowed (different zones)', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await logIn(page, USER1);
    // Give user1 access to Zone 1B (plan 2)
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });
    await logIn(page, USER1);

    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;
    const resp1 = await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    const resp2 = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(200);

    const rows = await querySql('SELECT sid FROM book WHERE login = $1 ORDER BY sid', [USER1.login]);
    expect(rows.rowCount).toBe(2);
  });

  test('booking two seats in Zone 1A at the same time is rejected (same zone)', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seats = await getZoneSeats(1);

    await logIn(page, USER1);
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    const resp1 = await apiApply(page, { book: { sid: zone1Seats[0].id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    const resp2 = await apiApply(page, { book: { sid: zone1Seats[1].id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(400);
    expect((await resp2.json()).code).toBe(109);
  });

  test('UI: booking Zone 1B does not auto-replace the Zone 1A booking', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    // Ensure user1 has access to Zone 1B
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });

    await logIn(page, USER1);
    await bookSeatUI(page, 1, zone1Seat, [ts]);

    // Navigate to plan 2 (Zone 1B) — seat should show as Green (bookable), not rebook
    await page.goto('/plan/2');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, zone2Seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    // Action should be "book" (not "update") — no conflict between different zones
    await expect(page.locator('.zone_action_btn[data-action="book"]')).toBeVisible();
    await clickActionBtn(page, 'book');

    // Both bookings exist — Zone 1A was NOT removed
    const rows = await querySql('SELECT sid FROM book WHERE login = $1 ORDER BY sid', [USER1.login]);
    expect(rows.rowCount).toBe(2);
    const sids = rows.rows.map((r: any) => Number(r.sid)).sort((a: number, b: number) => a - b);
    expect(sids).toContain(zone1Seat.id);
    expect(sids).toContain(zone2Seat.id);
  });

  test('mixed plan: booking in two different zones of the same plan is allowed', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    // Move zone2Seat onto plan 1 to create a mixed-zone plan
    await querySql('UPDATE seat SET pid = 1 WHERE id = $1', [zone2Seat.id]);

    // Give user1 access to Zone 1B
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });
    await logIn(page, USER1);

    // Book in zone 1 (plan 1)
    const resp1 = await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    // Book in zone 2 on the same plan — must NOT be blocked
    const resp2 = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(200);

    const cnt = await querySql('SELECT COUNT(*)::int AS c FROM book WHERE login = $1', [USER1.login]);
    expect(cnt.rows[0].c).toBe(2);
  });

  test('DB trigger: rejects overlapping bookings in the same zone', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seats = await getZoneSeats(1);

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seats[0].id, ts + 9 * 3600, ts + 17 * 3600]);

    await expect(querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seats[1].id, ts + 10 * 3600, ts + 12 * 3600],
    )).rejects.toThrow();
  });

  test('DB trigger: allows overlapping bookings in different zones', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seat.id, ts + 9 * 3600, ts + 17 * 3600]);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone2Seat.id, ts + 9 * 3600, ts + 17 * 3600]);

    const rows = await querySql('SELECT id FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(2);
  });

  test('desk and parking can be held simultaneously (different zones)', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const parkingSeat = (await getZoneSeats(3))[0];

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 3, change: [{ login: USER1.login, role: 20 }] });

    await logIn(page, USER1);
    await bookSeatUI(page, 1, zone1Seat, [ts]);
    await bookSeatUI(page, 3, parkingSeat, [ts]);

    const rows = await querySql(
      'SELECT sid FROM book WHERE login = $1 ORDER BY sid', [USER1.login]);
    expect(rows.rowCount).toBe(2);
  });

});

test.describe('zone group constraint (non-null zone_group)', () => {

  test('DB trigger: blocks booking in Zone 1B when both zones share zone_group and Zone 1A is booked', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    // Put both zones in the same group
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 2)");

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seat.id, ts + 9 * 3600, ts + 17 * 3600]);

    // Same group → second booking must be rejected by the trigger
    await expect(querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone2Seat.id, ts + 10 * 3600, ts + 12 * 3600],
    )).rejects.toThrow();
  });

  test('DB trigger: allows overlapping booking when zones have different zone_group values', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];

    await querySql("UPDATE zone SET zone_group = 'group-a' WHERE id = 1");
    await querySql("UPDATE zone SET zone_group = 'group-b' WHERE id = 2");

    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone1Seat.id, ts + 9 * 3600, ts + 17 * 3600]);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      [USER1.login, zone2Seat.id, ts + 9 * 3600, ts + 17 * 3600]);

    const rows = await querySql('SELECT id FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(2);
  });

  test('API: booking in Zone 1B (same group as Zone 1A) is rejected when Zone 1A is already booked', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id IN (1, 2)");

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });
    await logIn(page, USER1);

    const resp1 = await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    // Zone 1B is in the same group → must be blocked
    const resp2 = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(400);
    expect((await resp2.json()).code).toBe(109);
  });

  test('API: booking in zones with different zone_group values is allowed', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    await querySql("UPDATE zone SET zone_group = 'group-a' WHERE id = 1");
    await querySql("UPDATE zone SET zone_group = 'group-b' WHERE id = 2");

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });
    await logIn(page, USER1);

    const resp1 = await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    const resp2 = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(200);

    const cnt = await querySql('SELECT COUNT(*)::int AS c FROM book WHERE login = $1', [USER1.login]);
    expect(cnt.rows[0].c).toBe(2);
  });

  test('zone with null zone_group and zone with non-null zone_group do not interfere', async ({ page }) => {
    const ts = futureDayTs(1);
    const zone1Seat = (await getZoneSeats(1))[0];
    const zone2Seat = (await getZoneSeats(2))[0];
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;

    // Zone 1 NULL (per-zone), Zone 2 non-null group
    await querySql("UPDATE zone SET zone_group = NULL WHERE id = 1");
    await querySql("UPDATE zone SET zone_group = 'floor-1' WHERE id = 2");

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/assign', { zid: 2, change: [{ login: USER1.login, role: 20 }] });
    await logIn(page, USER1);

    const resp1 = await apiApply(page, { book: { sid: zone1Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp1.status()).toBe(200);

    // Zone 2 is in a group, but Zone 1 is NOT in that group (NULL ≠ 'floor-1')
    // so this second booking should succeed
    const resp2 = await apiApply(page, { book: { sid: zone2Seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp2.status()).toBe(200);

    const cnt = await querySql('SELECT COUNT(*)::int AS c FROM book WHERE login = $1', [USER1.login]);
    expect(cnt.rows[0].c).toBe(2);
  });

});
