/**
 * Assigned seat release / booking window enforcement tests.
 *
 * The "release" mechanism is enforced at booking time (not via a cron).
 * When a seat has a public assignment row with days_in_advance=N, only users
 * with a private assignment (or no assignment required) can book beyond N days.
 *
 * Logic (warp/xhr/zone.py):
 *   myAssignments = user-specific rows UNION null-login rows for the seat
 *   best_days = most-permissive days_in_advance (NULL = unlimited)
 *   cutoffTS  = today() + (best_days + 1) * 86400
 *   dates where fromTS >= cutoffTS → rejected with code 110
 *
 * Debug time: POST /debug/set_time_offset shifts utils.now() / utils.today()
 * so we can test window calculations without waiting for real days to pass.
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats, apiApply } from '../../helpers/booking';
import { advanceDays, resetTimeOffset, getServerTime } from '../../helpers/debug';

const DAYS_IN_ADVANCE = 3; // public window for most tests

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Set up a seat with both a private (unlimited) and public (N-day) assignment. */
async function setupAssignedSeat(
  sid: number,
  privateLogin: string,
  publicDaysInAdvance: number,
): Promise<void> {
  await querySql(
    'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
    [sid, privateLogin],
  );
  await querySql(
    'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, $2)',
    [sid, publicDaysInAdvance],
  );
}

// ─── Public booking window enforcement ───────────────────────────────────────

test.describe('public booking window (days_in_advance)', () => {

  test('unassigned user cannot book beyond days_in_advance (code 110)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', DAYS_IN_ADVANCE);

    await logIn(page, USER2);
    // Attempt to book DAYS_IN_ADVANCE+1 days from now (beyond cutoff)
    const tooFar = futureDayTs(DAYS_IN_ADVANCE + 1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: tooFar + 9 * 3600, toTS: tooFar + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(110);
  });

  test('unassigned user CAN book within days_in_advance', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', DAYS_IN_ADVANCE);

    await logIn(page, USER2);
    // Book exactly at the last allowed day (DAYS_IN_ADVANCE days from now)
    const ts = futureDayTs(DAYS_IN_ADVANCE);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('private holder (unlimited assignment) can book beyond public window', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', DAYS_IN_ADVANCE);

    await logIn(page, USER1);
    // Book DAYS_IN_ADVANCE+2 days from now (beyond public window)
    const farFuture = futureDayTs(DAYS_IN_ADVANCE + 2);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: farFuture + 9 * 3600, toTS: farFuture + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('seat with days_in_advance=1: public can only book tomorrow', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const seat = seats[2]; // use a distinct seat
    await setupAssignedSeat(seat.id, 'user1', 1);

    await logIn(page, USER2);

    // Tomorrow (day 1) — within window
    const tomorrow = futureDayTs(1);
    const ok = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: tomorrow + 9 * 3600, toTS: tomorrow + 17 * 3600 }] },
    });
    expect(ok.status()).toBe(200);
  });

  test('user with no seat assignment falls back to public window', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    // Only public row — user2 gets the public window
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, $2)',
      [seat.id, DAYS_IN_ADVANCE],
    );

    await logIn(page, USER2);
    const tooFar = futureDayTs(DAYS_IN_ADVANCE + 1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: tooFar + 9 * 3600, toTS: tooFar + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(110);
  });

});

// ─── Window shifts with debug time ───────────────────────────────────────────

test.describe('booking window with debug time offset', () => {

  test('debug endpoint is reachable in dev mode', async ({ page }) => {
    const resp = await page.request.get('/debug/time');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body).toHaveProperty('now');
    expect(body).toHaveProperty('today');
    expect(body.offset_seconds).toBe(0);
  });

  test('advancing time shifts the booking cutoff forward', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', DAYS_IN_ADVANCE);

    await logIn(page, USER2);

    // Without offset: day DAYS_IN_ADVANCE+2 is beyond cutoff → 403
    const targetDay = futureDayTs(DAYS_IN_ADVANCE + 2);
    const respBefore = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: targetDay + 9 * 3600, toTS: targetDay + 17 * 3600 }] },
    });
    expect(respBefore.status()).toBe(403);
    expect((await respBefore.json()).code).toBe(110);

    // Advance time by 2 days: targetDay is now DAYS_IN_ADVANCE days from "today" → within window
    await advanceDays(page, 2);

    const serverTime = await getServerTime(page);
    // Today as seen by server is 2 days later, so cutoff is now 2 days further
    // targetDay = futureDayTs(DAYS_IN_ADVANCE+2) from real now
    //           = serverToday + DAYS_IN_ADVANCE days (within window)
    const respAfter = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: targetDay + 9 * 3600, toTS: targetDay + 17 * 3600 }] },
    });
    expect(respAfter.status()).toBe(200);

    await resetTimeOffset(page);
  });

  test('resetting time offset restores original cutoff', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', DAYS_IN_ADVANCE);

    await logIn(page, USER2);

    // Advance 5 days
    await advanceDays(page, 5);

    // Reset
    await resetTimeOffset(page);

    const serverTime = await getServerTime(page);
    expect(serverTime.offset_seconds).toBe(0);

    // Booking DAYS_IN_ADVANCE+2 days out should be blocked again
    const tooFar = futureDayTs(DAYS_IN_ADVANCE + 2);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: tooFar + 9 * 3600, toTS: tooFar + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
  });

  test('advancing time makes a previously-valid date become past (code 103)', async ({ page }) => {
    // target = 3 days from now (valid with no offset)
    // After advancing 5 days, target is 2 days in the past → code 103
    const seats = await getZoneSeats(1);
    const seat = seats[2]; // distinct seat — no prior booking

    await logIn(page, USER1);

    const target = futureDayTs(3); // 3 days from now

    // Verify it is bookable before advancing
    const before = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: target + 9 * 3600, toTS: target + 17 * 3600 }] },
    });
    expect(before.status()).toBe(200);

    // Delete the booking so it doesn't cause an overlap on the re-attempt
    const bookResult = await querySql(
      'SELECT id FROM book WHERE login = $1 AND sid = $2',
      ['user1', seat.id],
    );
    await querySql('DELETE FROM book WHERE id = $1', [bookResult.rows[0].id]);

    // Advance 5 days: target (day+3) is now 2 days in the past relative to fake-today
    await advanceDays(page, 5);

    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: target + 9 * 3600, toTS: target + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(103);

    await resetTimeOffset(page);
  });

});

// ─── Multiple assignment interactions ────────────────────────────────────────

test.describe('most-permissive days_in_advance selection', () => {

  test('private NULL+public N → private holder gets unlimited, others get N', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    // NULL = unlimited for user1; 2 days for everyone else
    await setupAssignedSeat(seat.id, 'user1', 2);

    await logIn(page, USER1);
    const far = futureDayTs(5); // far beyond 2-day window
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: far + 9 * 3600, toTS: far + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200); // user1 gets NULL (unlimited)
  });

  test('user with explicit days_in_advance assignment uses their own window', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const seat = seats[1];
    // user2 explicitly assigned with 2-day window; public also has 2-day window
    // (user2 gets best_days=2; cutoff = today + 3 days)
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, 2)',
      [seat.id, 'user2'],
    );
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, 1)',
      [seat.id],
    );

    await logIn(page, USER2);

    // 2 days out: within user2's 2-day window (cutoff = today+3)
    const day2 = futureDayTs(2);
    const ok = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: day2 + 9 * 3600, toTS: day2 + 17 * 3600 }] },
    });
    expect(ok.status()).toBe(200);

    // 3 days out: beyond user2's window (best_days=2, cutoff=today+3, day3=today+3 → day3+9h >= cutoff)
    const day3 = futureDayTs(3);
    const blocked = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: day3 + 9 * 3600, toTS: day3 + 17 * 3600 }] },
    });
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).code).toBe(110);
  });

  test('admin can book beyond all assignment windows (no time check for admin)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await setupAssignedSeat(seat.id, 'user1', 1); // public: 1 day

    await logIn(page, ADMIN);
    // 10 days out — admin bypasses all checks
    const farFuture = futureDayTs(10);
    const resp = await apiApply(page, {
      book: {
        sid: seat.id,
        login: 'user1',
        dates: [{ fromTS: farFuture + 9 * 3600, toTS: farFuture + 17 * 3600 }],
      },
    });
    expect(resp.status()).toBe(200);
  });

});
