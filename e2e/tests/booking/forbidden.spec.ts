/**
 * Forbidden booking actions exercised via direct XHR calls.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats, apiApply } from '../../helpers/booking';

test.describe('forbidden booking actions (direct API)', () => {

  test('user with no zone access gets 403 (code 104)', async ({ page }) => {
    await logIn(page, USER3);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('user2 cannot book a Zone 1B seat (no access to zone 2)', async ({ page }) => {
    await logIn(page, USER2);
    const zone2Seats = await getZoneSeats(2);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: zone2Seats[0].id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
  });

  test('booking an already-booked seat returns 400 with code 109 (overlap)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const fromTS = ts + 9 * 3600;
    const toTS = ts + 17 * 3600;
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, fromTS, toTS],
    );

    await logIn(page, USER2);
    const resp = await apiApply(page, { book: { sid: seat.id, dates: [{ fromTS, toTS }] } });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(109);
  });

  test('partial time overlap also returns 400 / code 109', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 14 * 3600],
    );

    await logIn(page, USER2);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 12 * 3600, toTS: ts + 18 * 3600 }] },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(109);
  });

  test('user booking same seat twice (self-overlap) returns 400 / code 109', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const dates = [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }];

    const resp1 = await apiApply(page, { book: { sid: seat.id, dates } });
    expect(resp1.status()).toBe(200);

    const resp2 = await apiApply(page, { book: { sid: seat.id, dates } });
    expect(resp2.status()).toBe(400);
    expect((await resp2.json()).code).toBe(109);
  });

  test('booking a disabled seat returns 403 with code 105', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(105);
  });

  test('seat assigned to user1 only cannot be booked by user2 (code 106)', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const seat = seats[2];
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );

    await logIn(page, USER2);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(106);
  });

  test('non-admin cannot book in the past (code 103)', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: yesterday + 9 * 3600, toTS: yesterday + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(103);
  });

  test('non-admin cannot book beyond the allowed window (code 103)', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const tooFar = futureDayTs(14);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: tooFar + 9 * 3600, toTS: tooFar + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(103);
  });

  test('admin can book a seat on behalf of another user', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, login: 'user2', dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user2', seat.id],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

  test('admin can book in the past (no time-window restriction)', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: yesterday + 9 * 3600, toTS: yesterday + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('unauthenticated request to apply is redirected to login', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await page.request.post('/xhr/plan/apply', {
      data: { book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] } },
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
    expect([302, 401, 403]).toContain(resp.status());
  });

});
