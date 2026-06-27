/**
 * UI booking flows: basic book/release, multi-day, seat state conflicts.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  getZoneSeats,
  getFirstZoneDate,
  getSelectableDates,
  selectOnlyDates,
  clickZoneSeat,
  waitForSeatsLoaded,
  bookSeatUI,
  clickActionBtn,
} from '../../helpers/booking';

// ─── Basic Booking Flow ──────────────────────────────────────────────────────

test.describe('basic booking', () => {

  test('user1 can book a seat via the zone map UI', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user1', seat.id],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

  test('booking appears on the My Bookings page', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(page.locator('.tabulator-row').first()).toContainText(seat.name);
  });

  test('user1 can release their own booking', async ({ page }) => {
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
    await clickActionBtn(page, 'delete');

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1',
      ['user1'],
    );
    expect(result.rows[0].cnt).toBe(0);
  });

  test('user2 can independently book a different seat in Zone 1A', async ({ page }) => {
    await logIn(page, USER2);
    const seats = await getZoneSeats(1);
    const seat = seats[1];
    const ts = await getFirstZoneDate(page, 1);
    await bookSeatUI(page, 1, seat, [ts]);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user2', seat.id],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

});

// ─── Multi-Day Booking ───────────────────────────────────────────────────────

test.describe('multi-day booking', () => {

  test('booking two separate days creates two DB rows', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const selectable = await getSelectableDates(page);
    if (selectable.length < 2) test.skip();
    const ts1 = selectable[0];
    const ts2 = selectable[1];

    await selectOnlyDates(page, [ts1, ts2]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'book');

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user1', seat.id],
    );
    expect(result.rows[0].cnt).toBe(2);
  });

  test('deleting with two days selected removes both bookings', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const selectable = await getSelectableDates(page);
    if (selectable.length < 2) test.skip();
    const ts1 = selectable[0];
    const ts2 = selectable[1];

    await selectOnlyDates(page, [ts1, ts2]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'book');

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts1, ts2]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'delete');

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1',
      ['user1'],
    );
    expect(result.rows[0].cnt).toBe(0);
  });

});

// ─── Seat State Conflicts ────────────────────────────────────────────────────

test.describe('seat states and conflicts', () => {

  test('seat booked by user1 is un-clickable by user2 (TAKEN state)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER2);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);

    await expect(page.locator('#action_modal')).not.toHaveClass(/open/);
  });

  test("user1's own booking shows delete button, no book button (CAN_DELETE_EXACT)", async ({ page }) => {
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
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    await expect(page.locator('.plan_action_btn[data-action="book"]')).not.toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
  });

  test('user1 can rebook to another seat (Update button appears on target seat)', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seats[0].id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seats[1]);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="update"]')).toBeVisible();
  });

  test('Update replaces the old booking with the new seat', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seats[0].id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await clickZoneSeat(page, seats[1]);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'update');

    const oldResult = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user1', seats[0].id],
    );
    const newResult = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user1', seats[1].id],
    );
    expect(oldResult.rows[0].cnt).toBe(0);
    expect(newResult.rows[0].cnt).toBe(1);
  });

});
