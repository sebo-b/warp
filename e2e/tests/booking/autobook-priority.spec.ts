/**
 * Auto-book selection-priority heuristics (see AUTOBOOK.md §6).
 *
 * Per requested day, on the current plan, auto-book takes the first seat that is
 * free for all slots, by priority:
 *   1 the seat you already hold (extend/shrink)
 *   2 a seat assigned to you           — ordered by descending days-in-advance
 *   3 your most-used shared seat       — by cumulative booked TIME (not count)
 *   4 another seat in that seat's zone — "usual seat taken → same zone"
 *   5 a seat in the biggest zone       — the no-history default
 *   6 any free seat, at random         — to spread people
 *
 * Usage history is seeded as past bookings inside the ±AUTOBOOK_USAGE_WINDOW_DAYS
 * window (default 30 days).
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER2, USER3 } from '../../helpers/users';
import { futureDayTs } from '../../helpers/booking';
import {
  ZONE_TYPE_ENABLED,
  ZONE_ROLE_USER,
  createPlan,
  createZone,
  addSeats,
  assignZoneRole,
  assignSeat,
  insertBooking,
  countBookings,
  bookedSeatAt,
  bookedZone,
} from '../../helpers/zone-setup';

/** 09:00–17:00 on day N (N may be negative for past history). */
function slot(dayN: number): { fromTS: number; toTS: number } {
  const ts = futureDayTs(dayN);
  return { fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 };
}

/** A short HH..HH+1 slot on day N — for seeding "many short bookings" history. */
function shortSlot(dayN: number, hour: number): { fromTS: number; toTS: number } {
  const ts = futureDayTs(dayN);
  return { fromTS: ts + hour * 3600, toTS: ts + (hour + 1) * 3600 };
}

async function autoBook(page: any, pid: number, dates: object[], login?: string) {
  const data: any = { dates };
  if (login) data.login = login;
  return page.request.post(`/xhr/plan/autoBook/${pid}`, {
    data,
    headers: { 'Content-Type': 'application/json' },
    maxRedirects: 0,
  });
}

test.describe('auto-book selection priority', () => {

  test('a seat assigned to you wins over your most-used shared seat', async ({ page }) => {
    const pid = await createPlan('Prio Assigned Plan');
    const sharedZid = await createZone('Prio Shared', ZONE_TYPE_ENABLED);
    const reservedZid = await createZone('Prio Reserved', ZONE_TYPE_ENABLED);
    const [sharedSeat] = await addSeats(pid, sharedZid, ['SH.1']);
    const [reservedSeat] = await addSeats(pid, reservedZid, ['RE.1']);
    await assignZoneRole(sharedZid, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(reservedZid, 'user2', ZONE_ROLE_USER);
    await assignSeat(reservedSeat, 'user2', null); // reserved to user2, unlimited

    // Heavy history on the shared seat — it would win step 3, but step 2 (assigned) outranks it.
    await insertBooking('user2', sharedSeat, slot(-2).fromTS, slot(-2).toTS);
    await insertBooking('user2', sharedSeat, slot(-3).fromTS, slot(-3).toTS);

    await logIn(page, USER2);
    const target = slot(1);
    const resp = await autoBook(page, pid, [target]);
    expect(resp.status()).toBe(200);
    // The booking made for the target slot is on the reserved seat, not the shared one.
    expect(await bookedSeatAt('user2', target.fromTS)).toBe(reservedSeat);
  });

  test('assigned seats are tried in descending days-in-advance order', async ({ page }) => {
    const pid = await createPlan('Prio Dia Plan');
    const zid = await createZone('Prio Dia Zone', ZONE_TYPE_ENABLED);
    const [seatUnlimited, seatLimited] = await addSeats(pid, zid, ['U.1', 'L.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await assignSeat(seatUnlimited, 'user2', null); // unlimited dia
    await assignSeat(seatLimited, 'user2', 2);      // dia = 2 days

    await logIn(page, USER2);
    // Tomorrow is inside both windows; descending dia ⇒ the unlimited seat wins.
    const resp = await autoBook(page, pid, [slot(1)]);
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', seatUnlimited)).toBe(1);
    expect(await countBookings('user2', seatLimited)).toBe(0);
  });

  test('most-used shared seat is ranked by booked TIME, not number of bookings (desk vs phone booth)', async ({ page }) => {
    const pid = await createPlan('Prio Time Plan');
    const deskZid = await createZone('Prio Desk', ZONE_TYPE_ENABLED);
    const boothZid = await createZone('Prio Booth', ZONE_TYPE_ENABLED);
    const [deskSeat] = await addSeats(pid, deskZid, ['DESK.1']);
    const [boothSeat] = await addSeats(pid, boothZid, ['BOOTH.1']);
    await assignZoneRole(deskZid, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(boothZid, 'user2', ZONE_ROLE_USER);

    // Desk: one long (8h) booking. Booth: three short (1h) bookings — more bookings,
    // but less total time. Time-based ranking must prefer the desk.
    await insertBooking('user2', deskSeat, slot(-2).fromTS, slot(-2).toTS); // 8h
    await insertBooking('user2', boothSeat, shortSlot(-3, 9).fromTS, shortSlot(-3, 9).toTS);
    await insertBooking('user2', boothSeat, shortSlot(-4, 9).fromTS, shortSlot(-4, 9).toTS);
    await insertBooking('user2', boothSeat, shortSlot(-5, 9).fromTS, shortSlot(-5, 9).toTS);

    await logIn(page, USER2);
    const target = slot(1);
    const resp = await autoBook(page, pid, [target]);
    expect(resp.status()).toBe(200);
    // Desk has more total booked time (despite fewer bookings) → it is chosen.
    expect(await bookedSeatAt('user2', target.fromTS)).toBe(deskSeat);
  });

  test('when your usual seat is taken, another seat in the same zone is chosen', async ({ page }) => {
    const pid = await createPlan('Prio SameZone Plan');
    const homeZid = await createZone('Prio Home', ZONE_TYPE_ENABLED);
    const otherZid = await createZone('Prio Other', ZONE_TYPE_ENABLED);
    const [usualSeat, neighbourSeat] = await addSeats(pid, homeZid, ['HOME.1', 'HOME.2']);
    const [otherSeat] = await addSeats(pid, otherZid, ['OTHER.1']);
    await assignZoneRole(homeZid, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(otherZid, 'user2', ZONE_ROLE_USER);

    // user2's history makes `usualSeat` their most-used → home zone = homeZid.
    await insertBooking('user2', usualSeat, slot(-2).fromTS, slot(-2).toTS);
    // Someone else occupies the usual seat for the target day.
    await insertBooking('user3', usualSeat, slot(1).fromTS, slot(1).toTS);

    await logIn(page, USER2);
    const resp = await autoBook(page, pid, [slot(1)]);
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', neighbourSeat)).toBe(1); // same zone fallback
    expect(await countBookings('user2', otherSeat)).toBe(0);     // not the other zone
  });

  test('with no history, the biggest zone is preferred', async ({ page }) => {
    const pid = await createPlan('Prio Biggest Plan');
    const smallZid = await createZone('Prio Small', ZONE_TYPE_ENABLED);
    const bigZid = await createZone('Prio Big', ZONE_TYPE_ENABLED);
    await addSeats(pid, smallZid, ['SM.1']);
    await addSeats(pid, bigZid, ['BG.1', 'BG.2', 'BG.3']);
    await assignZoneRole(smallZid, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(bigZid, 'user2', ZONE_ROLE_USER);

    await logIn(page, USER2);
    const resp = await autoBook(page, pid, [slot(1)]);
    expect(resp.status()).toBe(200);
    // No usage history ⇒ pick the zone with the most seats (a specific seat within
    // it is chosen at random, so assert the zone, not the seat).
    expect(await bookedZone('user2', pid)).toBe(bigZid);
  });
});
