/**
 * Zone permission edge cases around "book as" (acting on behalf of another user),
 * site-admin super-user access, multi-zone plans, and public zones mixed with
 * regular/enabled zones.
 *
 * Scenario map (the tricky combinations this file locks down):
 *
 *   A. Site admin (account_type 10) is a super-user over every zone, even ones
 *      they are not explicitly assigned to:
 *        A1 view + self-book any plan with no zone assignment
 *        A2 book-as a user who has access, in an unassigned zone
 *        A3 cannot book-as a user who has no access to the zone
 *        A4 still cannot book a DISABLED-zone seat
 *
 *   B. Manual book-as by a *zone* admin, in multi-zone / public-mixed plans:
 *        B1 zone admin books-as in the zone they administer
 *        B2 zone admin CANNOT book-as in a PUBLIC_BOOK zone they don't administer
 *        B3 admin of a PUBLIC_BOOK zone can book-as anyone (public ⇒ USER)
 *        B4 admin of a PUBLIC_VIEW zone can book-as an explicit USER but not a
 *           view-only (public VIEWER) user
 *
 *   C. Auto-book ("find me a seat") as another user:
 *        C1 zone admin can auto-book-as (previously wrongly rejected with 403)
 *        C2 auto-book-as is confined to the zones the actor administers
 *        C3 site admin can auto-book-as anyone
 *        C4 a non-admin cannot auto-book-as
 *        C5 zone admin can auto-book-as via the FAB (UI)
 *
 *   D. Multi-zone exclusivity (book_overlap trigger) combined with book-as:
 *        D1 same zone-group ⇒ one seat per group (second book-as rejected, 109)
 *        D2 ungrouped zones ⇒ a user may hold a seat in each simultaneously
 *
 *   E. getSeats book-as guard:
 *        E1 a non-admin cannot use the ?login= / ?onlyOtherZone= parameters
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
  createPlan,
  createZone,
  addSeats,
  assignZoneRole,
  clearZoneRoles,
  countBookings,
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

    const resp = await page.request.get(`/xhr/zone/getSeats/${pid}`);
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(data.seats[String(seatId)].bookable).toBe(true);

    const bookResp = await apiApply(page, { book: { sid: seatId, dates: [slot(1)] } });
    expect(bookResp.status()).toBe(200);
    expect(await countBookings('admin', seatId)).toBe(1);
  });

  test('A2: can book as a user who has access, in an unassigned zone', async ({ page }) => {
    const pid = await createPlan('Superuser BookAs Plan');
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

  test('A3: cannot book as a user who has no access to the zone', async ({ page }) => {
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
// B. Manual book-as by a zone admin in multi-zone / public-mixed plans
// ---------------------------------------------------------------------------

test.describe('manual book-as in multi-zone / public-mixed plans', () => {

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

  test('B1: zone admin books-as a user in the zone they administer', async ({ page }) => {
    const { enabledSeat } = await setupEnabledPlusPublicBook();
    await logIn(page, USER1);
    const resp = await apiApply(page, { book: { sid: enabledSeat, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user2', enabledSeat)).toBe(1);
  });

  test('B2: zone admin CANNOT book-as in a public-book zone they do not administer', async ({ page }) => {
    const { publicSeat } = await setupEnabledPlusPublicBook();
    await logIn(page, USER1);
    // user1 is admin of the enabled zone but only an implicit USER of the public zone
    const resp = await apiApply(page, { book: { sid: publicSeat, login: 'user2', dates: [slot(1)] } });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
    expect(await countBookings('user2', publicSeat)).toBe(0);
  });

  test('B3: admin of a PUBLIC_BOOK zone can book-as any user', async ({ page }) => {
    const pid = await createPlan('PublicBook BookAs Plan');
    const zid = await createZone('PB Zone', ZONE_TYPE_PUBLIC_BOOK);
    const [seatId] = await addSeats(pid, zid, ['PB.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);

    await logIn(page, USER1);
    // user3 has no explicit role, but PUBLIC_BOOK grants everyone USER → bookable
    const resp = await apiApply(page, { book: { sid: seatId, login: 'user3', dates: [slot(1)] } });
    expect(resp.status()).toBe(200);
    expect(await countBookings('user3', seatId)).toBe(1);
  });

  test('B4: admin of a PUBLIC_VIEW zone can book-as an explicit USER but not a view-only user', async ({ page }) => {
    const pid = await createPlan('PublicView BookAs Plan');
    const zid = await createZone('PV Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [seatId] = await addSeats(pid, zid, ['PV.1']);
    await assignZoneRole(zid, 'user1', ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);

    await logIn(page, USER1);
    // user2 has explicit USER role → bookable
    const ok = await apiApply(page, { book: { sid: seatId, login: 'user2', dates: [slot(1)] } });
    expect(ok.status()).toBe(200);
    expect(await countBookings('user2', seatId)).toBe(1);

    // user3 only has implicit VIEWER via PUBLIC_VIEW → cannot be booked for
    const denied = await apiApply(page, { book: { sid: seatId, login: 'user3', dates: [slot(2)] } });
    expect(denied.status()).toBe(403);
    expect((await denied.json()).code).toBe(104);
    expect(await countBookings('user3', seatId)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// C. Auto-book ("find me a seat") as another user
// ---------------------------------------------------------------------------

test.describe('auto-book as another user', () => {

  async function autoBook(page: any, pid: number, dates: object[], login?: string) {
    const data: any = { dates };
    if (login) data.login = login;
    return page.request.post(`/xhr/zone/autoBook/${pid}`, {
      data,
      headers: { 'Content-Type': 'application/json' },
      maxRedirects: 0,
    });
  }

  test('C1: a zone admin can auto-book as another user', async ({ page }) => {
    const pid = await createPlan('AutoBookAs Plan');
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

  test('C2: auto-book-as acts as the target — even into a zone the actor does not administer', async ({ page }) => {
    // user1 administers zone A but NOT zone B; user2 can only book zone B. Auto-book
    // runs as user2, so it books user2 in zone B (where *they* have access) — the
    // actor's own zones do not constrain the seat pool.
    const pid = await createPlan('AutoBookAs ActsAsTarget Plan');
    const zidA = await createZone('AAT A', ZONE_TYPE_ENABLED); // user1 admin, user2 NO role
    const zidB = await createZone('AAT B', ZONE_TYPE_ENABLED); // user1 NOT admin, user2 user
    const [seatA] = await addSeats(pid, zidA, ['CA.1']);
    const [seatB] = await addSeats(pid, zidB, ['CB.1']);
    await assignZoneRole(zidA, 'user1', ZONE_ROLE_ADMIN); // user1 is a plan admin (admins zone A)
    await assignZoneRole(zidB, 'user2', ZONE_ROLE_USER);

    await logIn(page, USER1);
    const resp = await autoBook(page, pid, [slot(1)], 'user2');
    expect(resp.status()).toBe(200);
    expect((await resp.json()).booked.length).toBe(1);
    expect(await countBookings('user2', seatB)).toBe(1); // booked where user2 can book
    expect(await countBookings('user2', seatA)).toBe(0); // never in user1's-only zone
  });

  test('C3: a site admin can auto-book as anyone', async ({ page }) => {
    const pid = await createPlan('AutoBookAs Admin Plan');
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

  test('C4: a non-admin cannot auto-book as another user', async ({ page }) => {
    const pid = await createPlan('AutoBookAs Denied Plan');
    const zid = await createZone('ABA Denied Zone', ZONE_TYPE_ENABLED);
    await addSeats(pid, zid, ['AD.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER); // user2 is only a USER here

    await logIn(page, USER2);
    const resp = await autoBook(page, pid, [slot(1)], 'user1');
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('C5: a zone admin can auto-book as another user via the FAB (UI)', async ({ page }) => {
    // Plan 1 / Zone 1A: user1 is admin, user2 is a USER (via group_1a).
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const bookAsInput = page.locator('#book-as');
    await bookAsInput.click();
    await bookAsInput.pressSequentially('Bar', { delay: 50 });
    const item = page.locator('ul.autocomplete-content li', { hasText: 'Bar [user2]' });
    await expect(item).toBeVisible({ timeout: 5000 });
    await item.click();
    await page.waitForTimeout(200);

    const [resp] = await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/zone/autoBook')),
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
});

// ---------------------------------------------------------------------------
// D. Multi-zone exclusivity (book_overlap trigger) combined with book-as
// ---------------------------------------------------------------------------

test.describe('multi-zone exclusivity with book-as', () => {

  test('D1: same zone-group enforces one seat per group (second book-as rejected)', async ({ page }) => {
    const pid = await createPlan('Group BookAs Plan');
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
});

// ---------------------------------------------------------------------------
// E. getSeats book-as guard
// ---------------------------------------------------------------------------

test.describe('getSeats book-as guard', () => {

  test('E1: a non-admin cannot use the book-as query parameters', async ({ page }) => {
    // Zone 1A is enabled by default; user2 is a USER there (via group_1a), not an admin.
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/zone/getSeats/1?login=user1&onlyOtherZone=1', { maxRedirects: 0 });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(131);
  });
});
