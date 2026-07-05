/**
 * The pure-shrink bypass in apply().
 *
 * Invariant (PERMISSIONS.md §8): any operation that strictly shrinks the
 * actor's own bookings is always allowed, everywhere — release is the
 * shrink-to-zero case (already ungated); this generalises it to a shrink to a
 * subset. A self update (no book.login) whose every booked range is fully
 * covered by one of the actor's own bookings being removed on that seat skips
 * every booking check (role 104, DISABLED zone 104, seat-disabled 105,
 * assignment 106/110, horizon 103). Book-for is never a shrink.
 *
 * These are apply()-code-level tests (apiApply), matching the style of
 * zone-permissions-bookfor.spec.ts: the bypass is a server-side predicate on
 * the book+remove payload, so the assertions are on HTTP status + code and on
 * the persisted booking row seeded/read via the DB backchannel.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, apiApply } from '../../helpers/booking';
import {
  ZONE_TYPE_DISABLED,
  ZONE_TYPE_ENABLED,
  ZONE_TYPE_PUBLIC_VIEW,
  ZONE_ROLE_USER,
  createPlan,
  createZone,
  addSeats,
  assignZoneRole,
  assignSeat,
  insertBooking,
} from '../../helpers/zone-setup';

const DAY = futureDayTs(1);
const FULL = { fromTS: DAY + 9 * 3600, toTS: DAY + 17 * 3600 };
const NARROW = { fromTS: DAY + 10 * 3600, toTS: DAY + 16 * 3600 };
const EXTEND = { fromTS: DAY + 9 * 3600, toTS: DAY + 17 * 3600 + 3600 };

/** The booking id for a (login, sid, fromts) triple — the remove bid. */
async function bookingBid(login: string, sid: number, fromTS: number): Promise<number> {
  const r = await querySql(
    'SELECT id::int AS id FROM book WHERE login = $1 AND sid = $2 AND fromts = $3',
    [login, sid, fromTS],
  );
  expect(r.rows.length).toBe(1);
  return r.rows[0].id;
}

// ---------------------------------------------------------------------------
// Viewer zone (PUBLIC_VIEW): pure shrink allowed, extend still 104
// ---------------------------------------------------------------------------

test.describe('pure-shrink bypass: viewer zone', () => {
  test('shrink own booking -> 200, booking replaced', async ({ page }) => {
    const pid = await createPlan('Shrink Viewer Plan', 1);
    const zid = await createZone('Shrink Viewer', ZONE_TYPE_PUBLIC_VIEW);
    const [seat] = await addSeats(pid, zid, ['SV.1']);
    await insertBooking(USER3.login, seat, FULL.fromTS, FULL.toTS);
    const bid = await bookingBid(USER3.login, seat, FULL.fromTS);

    await logIn(page, USER3);            // pure viewer (no explicit role)
    const resp = await apiApply(page, { book: { sid: seat, dates: [NARROW] }, remove: [bid] });
    expect(resp.status()).toBe(200);

    const after = await querySql(
      'SELECT fromts::int AS f, tots::int AS t FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, seat],
    );
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].f).toBe(NARROW.fromTS);
    expect(after.rows[0].t).toBe(NARROW.toTS);
  });

  test('extend own booking (not a shrink) -> 403 / 104', async ({ page }) => {
    const pid = await createPlan('Extend Viewer Plan', 1);
    const zid = await createZone('Extend Viewer', ZONE_TYPE_PUBLIC_VIEW);
    const [seat] = await addSeats(pid, zid, ['EV.1']);
    // Booking narrower than the requested range so the request extends it.
    await insertBooking(USER3.login, seat, NARROW.fromTS, NARROW.toTS);
    const bid = await bookingBid(USER3.login, seat, NARROW.fromTS);

    await logIn(page, USER3);
    const resp = await apiApply(page, { book: { sid: seat, dates: [EXTEND] }, remove: [bid] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('shrink without the matching remove bid -> 403 / 104', async ({ page }) => {
    const pid = await createPlan('ShrinkNoRemove Viewer Plan', 1);
    const zid = await createZone('ShrinkNoRemove Viewer', ZONE_TYPE_PUBLIC_VIEW);
    const [seat] = await addSeats(pid, zid, ['SNR.1']);
    await insertBooking(USER3.login, seat, FULL.fromTS, FULL.toTS);

    await logIn(page, USER3);
    // No remove bid -> is_pure_shrink is false -> the viewer role check fires.
    const resp = await apiApply(page, { book: { sid: seat, dates: [NARROW] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });
});

// ---------------------------------------------------------------------------
// DISABLED zone: a shrink of an own booking is still allowed
// ---------------------------------------------------------------------------

test.describe('pure-shrink bypass: DISABLED zone', () => {
  test('shrink own booking in a DISABLED zone -> 200', async ({ page }) => {
    const pid = await createPlan('Shrink Disabled Plan', 1);
    const zid = await createZone('Shrink Disabled', ZONE_TYPE_DISABLED);
    const [seat] = await addSeats(pid, zid, ['SD.1']);
    await insertBooking(USER3.login, seat, FULL.fromTS, FULL.toTS);
    const bid = await bookingBid(USER3.login, seat, FULL.fromTS);

    await logIn(page, USER3);
    const resp = await apiApply(page, { book: { sid: seat, dates: [NARROW] }, remove: [bid] });
    expect(resp.status()).toBe(200);

    const after = await querySql(
      'SELECT fromts::int AS f, tots::int AS t FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, seat],
    );
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].f).toBe(NARROW.fromTS);
    expect(after.rows[0].t).toBe(NARROW.toTS);
  });
});

// ---------------------------------------------------------------------------
// Seat assigned to someone else: the assignment checks (106/110) are bypassed
// ---------------------------------------------------------------------------

test.describe('pure-shrink bypass: assigned-to-another seat', () => {
  test('shrink own booking on a seat assigned to another -> 200', async ({ page }) => {
    const pid = await createPlan('Shrink Assigned Plan', 1);
    const zid = await createZone('Shrink Assigned', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['SA.1']);
    await assignZoneRole(zid, USER3.login, ZONE_ROLE_USER);
    // Seat assigned to user1; user3 nonetheless holds a booking (seeded) —
    // shrinking it must bypass the assignment check (106).
    await assignSeat(seat, USER1.login, null);
    await insertBooking(USER3.login, seat, FULL.fromTS, FULL.toTS);
    const bid = await bookingBid(USER3.login, seat, FULL.fromTS);

    await logIn(page, USER3);
    const resp = await apiApply(page, { book: { sid: seat, dates: [NARROW] }, remove: [bid] });
    expect(resp.status()).toBe(200);

    const after = await querySql(
      'SELECT fromts::int AS f, tots::int AS t FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, seat],
    );
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].f).toBe(NARROW.fromTS);
    expect(after.rows[0].t).toBe(NARROW.toTS);
  });

  test('shrink without remove on an assigned-to-another seat -> 403 / 106', async ({ page }) => {
    const pid = await createPlan('ShrinkNoRemove Assigned Plan', 1);
    const zid = await createZone('ShrinkNoRemove Assigned', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['SNA.1']);
    await assignZoneRole(zid, USER3.login, ZONE_ROLE_USER);
    await assignSeat(seat, USER1.login, null);
    await insertBooking(USER3.login, seat, FULL.fromTS, FULL.toTS);

    await logIn(page, USER3);
    // No remove -> not a pure shrink -> the assignment check (106) fires.
    const resp = await apiApply(page, { book: { sid: seat, dates: [NARROW] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(106);
  });
});