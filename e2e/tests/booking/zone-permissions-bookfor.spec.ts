/**
 * Zone permission edge cases around "book for" (acting on behalf of another user),
 * site-admin super-user access, multi-zone plans, and public zones mixed with
 * regular/enabled zones.
 *
 * Scenario map (the tricky combinations this file locks down):
 *
 *   A. Site admin (account_type 10) is a super-user over every zone, even ones
 *      they are not explicitly assigned to:
 *        A1 view + self-book any plan with no zone assignment
 *        A2 book-for a user who has access, in an unassigned zone
 *        A3 cannot book-for a user who has no access to the zone
 *        A4 still cannot book a DISABLED-zone seat
 *
 *   B. Manual book-for by a *zone* admin, in multi-zone / public-mixed plans:
 *        B1 zone admin books-for in the zone they administer
 *        B2 zone admin CANNOT book-for in a PUBLIC_BOOK zone they don't administer
 *        B3 admin of a PUBLIC_BOOK zone can book-for anyone (public ⇒ USER)
 *        B4 admin of a PUBLIC_VIEW zone can book-for both an explicit USER and a
 *           view-only (public VIEWER) user — book-for only requires membership
 *        B5 book-for overrides a seat assignment to someone else
 *        B6 book-for overrides a seat's days-in-advance assignment window
 *
 *   C. Auto-book ("find me a seat") for another user:
 *        C1 zone admin can auto-book-for (previously wrongly rejected with 403)
 *        C2 auto-book-for is confined to the zones the actor administers
 *        C3 site admin can auto-book-for anyone
 *        C4 a non-admin cannot auto-book-for
 *        C5 zone admin can auto-book-for via the FAB (UI)
 *        C12 zone admin can auto-book-for a viewer into a zone they administer
 *
 *   D. Multi-zone exclusivity (book_overlap trigger) combined with book-for:
 *        D1 same zone-group ⇒ one seat per group (second book-for rejected, 109)
 *        D2 ungrouped zones ⇒ a user may hold a seat in each simultaneously
 *
 *   E. getSeats book-for guard:
 *        E1 a non-admin cannot use the ?login= book-for parameter
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, apiApply, waitForSeatsLoaded } from '../../helpers/booking';
import { pickFirstDate } from '../../helpers/zone-admin';
import {
  ZONE_TYPE_ENABLED,
  ZONE_TYPE_PUBLIC_VIEW,
  ZONE_TYPE_PUBLIC_BOOK,
  ZONE_ROLE_ADMIN,
  ZONE_ROLE_USER,
  ZONE_ROLE_VIEWER,
  createPlan,
  createZone,
  addSeats,
  assignZoneRole,
  assignSeat,
  clearZoneRoles,
  countBookings,
  insertBooking,
} from '../../helpers/zone-setup';

/** A standard 09:00–17:00 slot N days from now. */
function slot(daysFromNow = 1): { fromTS: number; toTS: number } {
  const ts = futureDayTs(daysFromNow);
  return { fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 };
}

// ---------------------------------------------------------------------------
// A. Site admin super-user access (no explicit zone assignment)
// ---------------------------------------------------------------------------

test.describe('site admin is a super-user over all zones', () => {

  test('A1: can view and self-book a plan in a zone they are not assigned to', async ({ page }) => {
    const pid = await createPlan('Superuser Plan');
    const zid = await createZone('Unassigned Enabled', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['S.1']);
    await clearZoneRoles('admin'); // admin has no zone_assign anywhere

    await logIn(page, ADMIN);

    const resp = await page.request.get(`/xhr/plan/getSeats/${pid}`);
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.seats[String(seatId)].bookable).toBe(true);

    const bookResp = await apiApply(page, { book: { sid: seatId, dates: [slot(1)] } });
    expect(bookResp.status()).toBe(200);
    expect(await countBookings('admin', seatId)).toBe(1);
  });

  test('A2: can book for a user who has access, in an unassigned zone', async ({ page }) => {
    const pid = await createPlan('Superuser BookFor Plan');
    const zid = await createZone('Enabled X', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['X.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await clearZoneRoles('admin');

    await logIn(page, ADMIN);
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', seatId)).toBe(1);
    expect(await countBookings('admin', seatId)).toBe(0);
  });

  test('A3: cannot book for a user who has no access to the zone', async ({ page }) => {
    const pid = await createPlan('Superuser NoAccess Plan');
    const zid = await createZone('Enabled Y', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['Y.1']);
    // user3 has no role here, the zone is not public

    await logIn(page, ADMIN);
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user3', dates: [slot(1)] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('A4: still cannot book a DISABLED-zone seat even as super-user', async ({ page }) => {
    const pid = await createPlan('Superuser Disabled Plan');
    const zid = await createZone('Disabled Z', 10 /* DISABLED */);
    const [seatId] = await addSeats(pid, zid, ['Z.1']);
    await clearZoneRoles('admin');

    await logIn(page, ADMIN);
    const resp = await apiApply(page, { book: { sid: seatId, dates: [slot(1)] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });
});

// ---------------------------------------------------------------------------
// B. Manual book-for by a zone admin in multi-zone / public-mixed plans
// ---------------------------------------------------------------------------

test.describe('manual book-for in multi-zone / public-mixed plans', () => {

  /** Plan with an ENABLED zone (user1 admin, user2 user) + a PUBLIC_BOOK zone. */
  async function setupEnabledPlusPublicBook() {
    const pid = await createPlan('Enabled+PublicBook Plan');
    const enabledZid = await createZone('BA Enabled', ZONE_TYPE_ENABLED);
    const publicZid = await createZone('BA PublicBook', ZONE_TYPE_PUBLIC_BOOK);
    const [enabledSeat] = await addSeats(pid, enabledZid, ['E.1']);
    const [publicSeat] = await addSeats(pid, publicZid, ['P.1']);
    await assignZoneRole(enabledZid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(enabledZid, 'user2', ZONE_ROLE_USER);
    // user1 has NO explicit role in the public-book zone (only implicit USER)
    return { pid, enabledZid, publicZid, enabledSeat, publicSeat };
  }

  test('B1: zone admin books-for a user in the zone they administer', async ({ page }) => {
    const { enabledSeat } = await setupEnabledPlusPublicBook();
    await logIn(page, USER1);
    const resp = await apiApply(page, { book: { sid: enabledSeat, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', enabledSeat)).toBe(1);
  });

  test('B2: zone admin CANNOT book-for in a public-book zone they do not administer', async ({ page }) => {
    const { publicSeat } = await setupEnabledPlusPublicBook();
    await logIn(page, USER1);
    // user1 is admin of the enabled zone but only an implicit USER of the public zone
    const resp = await apiApply(page, { book: { sid: publicSeat, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
    expect(await countBookings('user2', publicSeat)).toBe(0);
  });

  test('B3: admin of a PUBLIC_BOOK zone can book-for any user', async ({ page }) => {
    const pid = await createPlan('PublicBook BookFor Plan');
    const zid = await createZone('PB Zone', ZONE_TYPE_PUBLIC_BOOK);
    const [seatId] = await addSeats(pid, zid, ['PB.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);

    await logIn(page, USER1);
    // user3 has no explicit role, but PUBLIC_BOOK grants everyone USER → bookable
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user3', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user3', seatId)).toBe(1);
  });

  test('B4: admin of a PUBLIC_VIEW zone can book-for both an explicit USER and a view-only user', async ({ page }) => {
    const pid = await createPlan('PublicView BookFor Plan');
    const zid = await createZone('PV Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [seatId] = await addSeats(pid, zid, ['PV.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);

    await logIn(page, USER1);
    // user2 has explicit USER role → bookable
    const ok = await apiApply(page, { book: { sid: seatId, login: 'user2', dates: [slot(1)] } });
    expect(ok.status()).toBe(200);
    expect(await countBookings('user2', seatId)).toBe(1);

    // user3 only has implicit VIEWER via PUBLIC_VIEW — under book-for, membership
    // (not role <= USER) is all that's required, since the admin overrides the
    // viewer restriction for this booking.
    const alsoOk = await apiApply(page, { book: { sid: seatId, login: 'user3', dates: [slot(2)] } });
    expect(alsoOk.status()).toBe(200);
    expect(await countBookings('user3', seatId)).toBe(1);
  });

  test('B5: book-for overrides a seat assignment to someone else', async ({ page }) => {
    const pid = await createPlan('BookFor Assignment Override Plan');
    const zid = await createZone('BA Assign Zone', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['BA.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zid, 'user3', ZONE_ROLE_USER);
    await assignSeat(seatId, 'user3'); // seat is assigned to user3 only

    await logIn(page, USER1);
    // A regular (non-book-for) booking by user2 would be rejected with 106 —
    // but the zone admin booking FOR user2 overrides the assignment.
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', seatId)).toBe(1);
  });

  test('B6: book-for overrides a seat\'s days-in-advance assignment window', async ({ page }) => {
    const pid = await createPlan('BookFor Days-In-Advance Override Plan');
    const zid = await createZone('BA Dia Zone', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['DIA.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await assignSeat(seatId, 'user2', 0); // user2 may normally only book 0 days out

    await logIn(page, USER1);
    // 3 days out: beyond the assignment's 0-days-in-advance window (would
    // normally be 110), but within the default 1-week global booking horizon
    // (code 103), so this isolates the assignment-window override.
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user2', dates: [slot(3)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', seatId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// C. Auto-book ("find me a seat") for another user
// ---------------------------------------------------------------------------

test.describe('auto-book for another user', () => {

  async function autoBook(page: any, pid: number, dates: object[], login?: string) {
    const data: any = { dates };
    if (login) data.login = login;
    return page.request.post(`/xhr/plan/autoBook/${pid}`, {
      data,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
  }

  test('C1: a zone admin can auto-book for another user', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Plan');
    const zid = await createZone('ABA Zone', ZONE_TYPE_ENABLED);
    await addSeats(pid, zid, ['A.1', 'A.2']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBeGreaterThan(0);

    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book b JOIN seat s ON b.sid = s.id WHERE b.login = $1 AND s.pid = $2',
      ['user2', pid],
    );
    expect(r.rows[0].cnt).toBeGreaterThan(0);
  });

  test('C2: auto-book-for is confined — cannot book into a zone the actor does not administer', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Confined Plan');
    const zidA = await createZone('Conf A', ZONE_TYPE_ENABLED);
    const zidB = await createZone('Conf B', ZONE_TYPE_ENABLED);
    const [seatA] = await addSeats(pid, zidA, ['CA.1']);
    const [seatB] = await addSeats(pid, zidB, ['CB.1']);
    await assignZoneRole(zidA, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);
    // user2 has no role in zone A, and user1 is not admin of zone B.
    // user1 auto-books-for user2: subject has no accessible seat in user1's managed zone A,
    // so the endpoint rejects with 403/104.

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
    expect(await countBookings('user2', seatA)).toBe(0);
    expect(await countBookings('user2', seatB)).toBe(0);
  });

  test('C2b: auto-book-for lands the subject in a zone the actor administers', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Positive Plan');
    const zidA = await createZone('Pos A', ZONE_TYPE_ENABLED);
    const zidB = await createZone('Pos B', ZONE_TYPE_ENABLED);
    const [seatA] = await addSeats(pid, zidA, ['PA.1']);
    const [seatB] = await addSeats(pid, zidB, ['PB.1']);
    await assignZoneRole(zidA, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zidA, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);
    // user1 administers zone A only; user2 has USER in both A and B.
    // Auto-book-for must confine to zone A — user2 lands in A, never B.

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.booked.length).toBe(1);
    expect(await countBookings('user2', seatA)).toBe(1);
    expect(await countBookings('user2', seatB)).toBe(0);
  });

  test('C3: a site admin can auto-book for anyone', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Admin Plan');
    const zid = await createZone('ABA Admin Zone', ZONE_TYPE_ENABLED);
    await addSeats(pid, zid, ['AA.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await clearZoneRoles('admin');

    await logIn(page, ADMIN);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBeGreaterThan(0);
    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book b JOIN seat s ON b.sid = s.id WHERE b.login = $1 AND s.pid = $2',
      ['user2', pid],
    );
    expect(r.rows[0].cnt).toBeGreaterThan(0);
  });

  test('C4: a non-admin cannot auto-book for another user', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Denied Plan');
    const zid = await createZone('ABA Denied Zone', ZONE_TYPE_ENABLED);
    await addSeats(pid, zid, ['AD.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER); // user2 is only a USER here

    await logIn(page, USER2);
    const resp = await autoBook(page, pid, [slot(1)], 'user1');
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('C5: a zone admin can auto-book for another user via the FAB (UI)', async ({ page }) => {
    // Plan 1 / Zone 1A: user1 is admin, user2 is a USER (via group_1a).
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const bookForInput = page.locator('#book-for');
    await bookForInput.click();
    await bookForInput.pressSequentially('Bar', { delay: 50 });
    const item = page.locator('ul.autocomplete-content li', { hasText: 'Bar [user2]' });
    await expect(item).toBeVisible({ timeout: 5000 });
    await item.click();
    await page.waitForTimeout(200);

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/autoBook')),
      page.locator('#auto_book_btn').click(),
    ]);
    expect(resp.status()).toBe(200);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const r = await querySql(
      "SELECT COUNT(*)::int AS cnt FROM book b JOIN seat s ON b.sid = s.id WHERE b.login = 'user2' AND s.pid = 1",
    );
    expect(r.rows[0].cnt).toBeGreaterThan(0);
  });

  test('C6: site admin self auto-book ignores zones where they have no regular rights', async ({ page }) => {
    // Zone A: admin has a real (explicit) booking grant. Zone B: admin has NO
    // grant — only the super-user bypass. Self auto-book must land in A, never B.
    const pid = await createPlan('Admin Self AutoBook Plan');
    const zidA = await createZone('Self Regular A', ZONE_TYPE_ENABLED);
    const zidB = await createZone('Self Bypass B', ZONE_TYPE_ENABLED);
    const [seatA] = await addSeats(pid, zidA, ['RA.1']);
    const [seatB] = await addSeats(pid, zidB, ['BB.1']);
    await clearZoneRoles('admin');
    await assignZoneRole(zidA, 'admin', ZONE_ROLE_USER); // regular booking right in A only

    await logIn(page, ADMIN);
    const resp = await autoBook(page, pid, [slot(1)]); // self
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBe(1);
    expect(await countBookings('admin', seatA)).toBe(1);
    expect(await countBookings('admin', seatB)).toBe(0);
  });

  test('C7: site admin self auto-book is rejected when they hold no regular booking rights', async ({ page }) => {
    // A private plan the admin only reaches via the super-user bypass: self
    // auto-book must not silently pick a seat there.
    const pid = await createPlan('Admin No-Rights Plan');
    const zid = await createZone('Bypass-only Zone', ZONE_TYPE_ENABLED);
    await addSeats(pid, zid, ['NR.1']);
    await clearZoneRoles('admin');

    await logIn(page, ADMIN);
    const resp = await autoBook(page, pid, [slot(1)]); // self
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('C8: self auto-book includes everyone-can-book (PUBLIC_BOOK) zones, even for an admin with no explicit grant', async ({ page }) => {
    // PUBLIC_BOOK grants everyone a *regular* USER right, so the zone is eligible
    // for self auto-book regardless of the super-user bypass.
    const pid = await createPlan('Admin Public AutoBook Plan');
    const zid = await createZone('Everyone Can Book Z', ZONE_TYPE_PUBLIC_BOOK);
    const [seatId] = await addSeats(pid, zid, ['PBA.1']);
    await clearZoneRoles('admin'); // no explicit grant; access here is the public baseline

    await logIn(page, ADMIN);
    const resp = await autoBook(page, pid, [slot(1)]); // self
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBe(1);
    expect(await countBookings('admin', seatId)).toBe(1);
  });

  test('C9: a regular user can self auto-book in a PUBLIC_BOOK zone with no explicit grant', async ({ page }) => {
    const pid = await createPlan('User Public AutoBook Plan');
    const zid = await createZone('Everyone Can Book Z2', ZONE_TYPE_PUBLIC_BOOK);
    const [seatId] = await addSeats(pid, zid, ['PBU.1']);
    // user3 has no zone assignments at all → relies purely on the public baseline

    await logIn(page, USER3);
    const resp = await autoBook(page, pid, [slot(1)]); // self
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBe(1);
    expect(await countBookings('user3', seatId)).toBe(1);
  });

  test('C10: release gate — auto-book-for cannot release a booking in an unmanaged same-group zone', async ({ page }) => {
    const pid = await createPlan('Release Gate Plan');
    const zidA = await createZone('RelGrp A', ZONE_TYPE_ENABLED, 'relGrp');
    const zidB = await createZone('RelGrp B', ZONE_TYPE_ENABLED, 'relGrp');
    const [seatA] = await addSeats(pid, zidA, ['RA.1']);
    const [seatB] = await addSeats(pid, zidB, ['RB.1']);
    await assignZoneRole(zidA, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zidA, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);
    // user1 administers zone A only; zone B is in the same group but not administered.
    const s = slot(1);
    // Pre-book user2 in zone B for the morning only (09:00-13:00). Auto-book-for
    // requests the full day (09:00-17:00) — the exact-match shortcut won't fire
    // because the times differ. A candidate in zone A would conflict with B's
    // same-group booking, and can_release must block releasing B's booking.
    await insertBooking('user2', seatB, s.fromTS, s.fromTS + 4 * 3600);
    expect(await countBookings('user2', seatB)).toBe(1);

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [s], 'user2');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.booked.length).toBe(0);
    expect(body.not_extended.length + body.unbookable.length).toBeGreaterThan(0);
    expect(await countBookings('user2', seatB)).toBe(1);
    expect(await countBookings('user2', seatA)).toBe(0);
  });

  test('C11: preservation — auto-book rolls back on cross-plan same-group conflict, original booking kept', async ({ page }) => {
    // Plan P1 / zone A (group 'xgrp'): user2 has a partial-day booking (09-13)
    // on seat A1. Plan P2 / zone B (same group): user2 has an afternoon booking
    // (14-17) on seat B1. These don't overlap each other, so the trigger allows
    // both. Auto-book on P1 requests the full day (09-17); it doesn't see the
    // P2 booking (allBookings is plan-scoped), finds seat A1 as a candidate,
    // deletes the 09-13 booking and tries to insert 09-17. The DB trigger
    // rejects the insert (cross-plan same-group overlap with the 14-17 booking)
    // → atomic rollback. The original 09-13 booking on P1 survives.
    const pid1 = await createPlan('Rollback Plan 1');
    const zidA = await createZone('Rollback A', ZONE_TYPE_ENABLED, 'xgrp');
    const [seatA] = await addSeats(pid1, zidA, ['RA.1']);
    await assignZoneRole(zidA, 'user2', ZONE_ROLE_USER);

    const pid2 = await createPlan('Rollback Plan 2');
    const zidB = await createZone('Rollback B', ZONE_TYPE_ENABLED, 'xgrp');
    const [seatB] = await addSeats(pid2, zidB, ['RB.1']);
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);

    const s = slot(1);
    await insertBooking('user2', seatA, s.fromTS, s.fromTS + 4 * 3600);
    await insertBooking('user2', seatB, s.fromTS + 5 * 3600, s.toTS);
    expect(await countBookings('user2', seatA)).toBe(1);
    expect(await countBookings('user2', seatB)).toBe(1);

    await logIn(page, USER2);
    const resp = await autoBook(page, pid1, [s]);
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(109);
    expect(await countBookings('user2', seatA)).toBe(1);
    expect(await countBookings('user2', seatB)).toBe(1);
  });

  test('C12: a zone admin can auto-book for a viewer into a zone they administer', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Viewer Plan');
    const zid = await createZone('ABA Viewer Zone', ZONE_TYPE_ENABLED);
    const [seatId] = await addSeats(pid, zid, ['AV.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_VIEWER); // viewer only, not a booking role

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.booked.length).toBe(1);
    expect(await countBookings('user2', seatId)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// D. Multi-zone exclusivity (book_overlap trigger) combined with book-for
// ---------------------------------------------------------------------------

test.describe('multi-zone exclusivity with book-for', () => {

  test('D1: same zone-group enforces one seat per group (second book-for rejected)', async ({ page }) => {
    const pid = await createPlan('Group BookFor Plan');
    const zidA = await createZone('Grp A', ZONE_TYPE_ENABLED, 'grpG');
    const zidB = await createZone('Grp B', ZONE_TYPE_ENABLED, 'grpG');
    const [seatA] = await addSeats(pid, zidA, ['GA.1']);
    const [seatB] = await addSeats(pid, zidB, ['GB.1']);
    for (const z of [zidA, zidB]) {
      await assignZoneRole(z, 'user1', ZONE_ROLE_ADMIN);
      await assignZoneRole(z, 'user2', ZONE_ROLE_USER);
    }
    const s = slot(1);
    await querySql('INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seatA, s.fromTS, s.toTS]);

    await logIn(page, USER1);
    const resp = await apiApply(page, { book: { sid: seatB, login: 'user2', dates: [s] } });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(109);
    expect(await countBookings('user2', seatB)).toBe(0);
  });

  test('D2: ungrouped zones let a user hold a seat in each at the same time', async ({ page }) => {
    const pid = await createPlan('Ungrouped Plan');
    const zidA = await createZone('Ung A', ZONE_TYPE_ENABLED); // no group
    const zidB = await createZone('Ung B', ZONE_TYPE_ENABLED); // no group
    const [seatA] = await addSeats(pid, zidA, ['UA.1']);
    const [seatB] = await addSeats(pid, zidB, ['UB.1']);
    for (const z of [zidA, zidB]) {
      await assignZoneRole(z, 'user1', ZONE_ROLE_ADMIN);
      await assignZoneRole(z, 'user2', ZONE_ROLE_USER);
    }
    const s = slot(1);
    await querySql('INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seatA, s.fromTS, s.toTS]);

    await logIn(page, USER1);
    const resp = await apiApply(page, { book: { sid: seatB, login: 'user2', dates: [s] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', seatA)).toBe(1);
    expect(await countBookings('user2', seatB)).toBe(1);
  });

  test('D3: manual rebook cannot release a booking in an unmanaged same-group zone', async ({ page }) => {
    const pid = await createPlan('Manual Release Gate Plan');
    const zidA = await createZone('MRelGrp A', ZONE_TYPE_ENABLED, 'mrelGrp');
    const zidB = await createZone('MRelGrp B', ZONE_TYPE_ENABLED, 'mrelGrp');
    const [seatA] = await addSeats(pid, zidA, ['MA.1']);
    const [seatB] = await addSeats(pid, zidB, ['MB.1']);
    await assignZoneRole(zidA, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zidA, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);
    const s = slot(1);
    await insertBooking('user2', seatB, s.fromTS, s.toTS);
    expect(await countBookings('user2', seatB)).toBe(1);

    const bookData = await querySql(
      'SELECT id FROM book WHERE login = $1 AND sid = $2',
      ['user2', seatB],
    );
    const removeBid = bookData.rows[0].id;

    await logIn(page, USER1);
    const resp = await apiApply(page, {
      book: { sid: seatA, login: 'user2', dates: [s] },
      remove: [removeBid],
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
    expect(await countBookings('user2', seatB)).toBe(1);
    expect(await countBookings('user2', seatA)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. getSeats book-for guard
// ---------------------------------------------------------------------------

test.describe('getSeats book-for guard', () => {

  test('E1: a non-admin cannot use the book-for query parameters', async ({ page }) => {
    // Zone 1A is enabled by default; user2 is a USER there (via group_1a), not an admin.
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/plan/getSeats/1?login=user1', { maxRedirects: 0 });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(131);
  });
});

// ---------------------------------------------------------------------------
// F. Cross-zone book-for release confinement (security regression)
//
// Guards the invariant that a zone admin who administers only Z1 (but is a
// mere USER in Z2, same zone group) can NEVER release another user's Z2 booking
// by booking them in Z1 — even though the same-group conflict_bids() would
// otherwise collect the Z2 booking for release.  This must fail if
// releaseZids=manageableZids is dropped from the runAutoBook call, or if
// manageableZids is widened beyond zones where the actor is ADMIN.
// (See plan-expand-user-to-zone-roles.md §3.3.)
// ---------------------------------------------------------------------------

test.describe('cross-zone book-for release confinement', () => {

  async function autoBook(page: any, pid: number, dates: object[], login?: string) {
    const data: any = { dates };
    if (login) data.login = login;
    return page.request.post(`/xhr/plan/autoBook/${pid}`, {
      data,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
  }

  test('F1: auto-book-for never releases a booking in an unmanaged same-group zone', async ({ page }) => {
    // Z1 and Z2 share a zone group.  A1 (user1) is ADMIN on Z1 but only USER on
    // Z2.  U (user2) has USER access to both.  U already holds a seat in Z2.
    // A1 auto-books-for U for the same day: a Z1 candidate would conflict with U's
    // same-group Z2 booking, but can_release must reject releasing it (Z2 is not
    // in A1's manageableZids).  The day is returned unbookable / not_extended, and
    // U's Z2 booking survives untouched.
    const pid = await createPlan('XConf Release Plan');
    const zid1 = await createZone('XConf Z1', ZONE_TYPE_ENABLED, 'xconf');
    const zid2 = await createZone('XConf Z2', ZONE_TYPE_ENABLED, 'xconf');
    const [seat1] = await addSeats(pid, zid1, ['X1.1']);
    const [seat2] = await addSeats(pid, zid2, ['X2.1']);
    await assignZoneRole(zid1, 'user1', ZONE_ROLE_ADMIN); // A1 administers Z1
    await assignZoneRole(zid2, 'user1', ZONE_ROLE_USER);  // A1 is only USER in Z2
    await assignZoneRole(zid1, 'user2', ZONE_ROLE_USER);  // U can book Z1
    await assignZoneRole(zid2, 'user2', ZONE_ROLE_USER);  // U can book Z2

    const s = slot(1);
    // U holds a partial-day booking in Z2 (09:00-13:00).  Auto-book-for requests
    // the full day (09:00-17:00), so the exact-match shortcut won't fire and a
    // Z1 candidate would conflict with U's same-group Z2 booking — can_release
    // must block releasing it (Z2 is not in A1's manageableZids).
    await insertBooking('user2', seat2, s.fromTS, s.fromTS + 4 * 3600);
    expect(await countBookings('user2', seat2)).toBe(1);

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [s], 'user2');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    // Not booked by release: no new booking was created.
    expect(body.booked.length).toBe(0);
    expect(body.not_extended.length + body.unbookable.length).toBeGreaterThan(0);
    // Regression guard: U's Z2 booking must still exist, and no Z1 booking.
    expect(await countBookings('user2', seat2)).toBe(1);
    expect(await countBookings('user2', seat1)).toBe(0);
  });

  test('F2: apply() remove cannot delete a booking in an unadministered same-group zone', async ({ page }) => {
    // The per-seat zone-admin check in apply() must reject A1 removing U's Z2
    // booking (A1 does not administer Z2).
    const pid = await createPlan('XConf Remove Plan');
    const zid1 = await createZone('XRem Z1', ZONE_TYPE_ENABLED, 'xrem');
    const zid2 = await createZone('XRem Z2', ZONE_TYPE_ENABLED, 'xrem');
    const [seat1] = await addSeats(pid, zid1, ['R1.1']);
    const [seat2] = await addSeats(pid, zid2, ['R2.1']);
    await assignZoneRole(zid1, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid2, 'user1', ZONE_ROLE_USER);
    await assignZoneRole(zid1, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zid2, 'user2', ZONE_ROLE_USER);

    const s = slot(1);
    await insertBooking('user2', seat2, s.fromTS, s.toTS);
    const bidRow = await querySql(
      'SELECT id FROM book WHERE login = $1 AND sid = $2',
      ['user2', seat2],
    );
    const removeBid = bidRow.rows[0].id;

    await logIn(page, USER1);
    const resp = await apiApply(page, { remove: [removeBid] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
    expect(await countBookings('user2', seat2)).toBe(1);
  });

  test('F3: apply() book only inserts — a same-group conflict is rejected, never silently released', async ({ page }) => {
    // The book action never releases a conflicting booking: it inserts only, and
    // the DB trigger rejects a same-group overlap (109).  A1 books-for U on Z1 for
    // the same slot U already holds in Z2 (same group) → 109, and U's Z2 booking
    // is untouched.
    const pid = await createPlan('XConf Book Plan');
    const zid1 = await createZone('XBook Z1', ZONE_TYPE_ENABLED, 'xbook');
    const zid2 = await createZone('XBook Z2', ZONE_TYPE_ENABLED, 'xbook');
    const [seat1] = await addSeats(pid, zid1, ['B1.1']);
    const [seat2] = await addSeats(pid, zid2, ['B2.1']);
    await assignZoneRole(zid1, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid2, 'user1', ZONE_ROLE_USER);
    await assignZoneRole(zid1, 'user2', ZONE_ROLE_USER);
    await assignZoneRole(zid2, 'user2', ZONE_ROLE_USER);

    const s = slot(1);
    await insertBooking('user2', seat2, s.fromTS, s.toTS);
    expect(await countBookings('user2', seat2)).toBe(1);

    await logIn(page, USER1);
    const resp = await apiApply(page, { book: { sid: seat1, login: 'user2', dates: [s] } });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(109);
    // Z2 booking untouched, no Z1 booking created.
    expect(await countBookings('user2', seat2)).toBe(1);
    expect(await countBookings('user2', seat1)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// D. Book-for onto a disabled seat: a zone admin may override a
// seat-level disable (they could re-enable it anyway) when booking FOR a
// target. The zone-type DISABLED block (104) still applies — only the
// seat-enabled check (105) is skipped under is_book_for. Self-booking onto a
// disabled seat stays 105, and auto-book-for never picks a disabled seat.
// ---------------------------------------------------------------------------

async function disableSeat(seatId: number): Promise<void> {
  await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seatId]);
}

test.describe('book-for onto a disabled seat (zone-admin override)', () => {
  test('D1: book-for onto a disabled seat -> 200; self-book onto it -> 403 / 105', async ({ page }) => {
    const pid = await createPlan('BookFor Disabled Seat Plan');
    const zid = await createZone('BFD Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['BFD.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await disableSeat(seat);

    await logIn(page, USER1);
    // Book-for user2 onto the disabled seat -> the admin overrides the disable.
    const ok = await apiApply(page, { book: { sid: seat, login: 'user2', dates: [slot(1)] } });
    expect(ok.status()).toBe(200);
    expect(await countBookings('user2', seat)).toBe(1);

    // Clear it and try a self-book onto the same disabled seat -> 105.
    await querySql('DELETE FROM book WHERE sid = $1', [seat]);
    const denied = await apiApply(page, { book: { sid: seat, dates: [slot(1)] } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe(105);
    expect(await countBookings('user1', seat)).toBe(0);
  });

  test('D2: auto-book-for never picks a disabled seat (only free seat -> booked empty)', async ({ page }) => {
    const pid = await createPlan('AutoBookFor Disabled Plan');
    const zid = await createZone('ABD Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['ABD.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    await disableSeat(seat);   // the only seat, and it is disabled

    await logIn(page, USER1);
    const resp = await page.request.post(`/xhr/plan/autoBook/${pid}`, {
      data: { dates: [slot(1)], login: 'user2' },
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked).toEqual([]);
    expect(await countBookings('user2', seat)).toBe(0);
  });
});
