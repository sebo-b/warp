/**
 * Zone permission scenarios: PUBLIC_VIEW, PUBLIC_BOOK, DISABLED, and mixed-zone plans.
 *
 * Zone types (from warp/db.py):
 *   ZONE_TYPE_DISABLED    = 10
 *   ZONE_TYPE_ENABLED     = 20
 *   ZONE_TYPE_PUBLIC_VIEW = 30
 *   ZONE_TYPE_PUBLIC_BOOK = 40
 *
 * Zone roles:
 *   ZONE_ROLE_ADMIN  = 10
 *   ZONE_ROLE_USER   = 20
 *   ZONE_ROLE_VIEWER = 30
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  getZoneSeats,
  apiApply,
  selectOnlyDates,
  waitForSeatsLoaded,
  getFirstZoneDate,
  clickZoneSeat,
} from '../../helpers/booking';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Set zone_type on an existing zone. */
async function setZoneType(zid: number, zoneType: number): Promise<void> {
  await querySql('UPDATE zone SET zone_type = $1 WHERE id = $2', [zoneType, zid]);
}

/** Create a new zone and return its id. */
async function createZone(name: string, zoneType: number): Promise<number> {
  const result = await querySql(
    'INSERT INTO zone (name, zone_type) VALUES ($1, $2) RETURNING id',
    [name, zoneType],
  );
  const zid = Number(result.rows[0].id);
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('zone', 'id'), (SELECT MAX(id) FROM zone))",
  );
  return zid;
}

/** Create a new plan and return its id. */
async function createPlan(name: string, iid: number | null): Promise<number> {
  const result = await querySql(
    'INSERT INTO plan (name, iid) VALUES ($1, $2) RETURNING id',
    [name, iid],
  );
  const pid = Number(result.rows[0].id);
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('plan', 'id'), (SELECT MAX(id) FROM plan))",
  );
  return pid;
}

/** Add seats to a plan+zone. Returns the seat ids. */
async function addSeats(pid: number, zid: number, names: string[]): Promise<number[]> {
  const ids: number[] = [];
  for (let i = 0; i < names.length; i++) {
    const result = await querySql(
      'INSERT INTO seat (pid, zid, name, x, y) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [pid, zid, names[i], 100 + i * 70, 100],
    );
    ids.push(Number(result.rows[0].id));
  }
  await querySql(
    "SELECT pg_catalog.setval(pg_get_serial_sequence('seat', 'id'), (SELECT MAX(id) FROM seat))",
  );
  return ids;
}

/** Assign a user (or group) to a zone with a given role. */
async function assignZoneRole(zid: number, login: string, role: number): Promise<void> {
  await querySql(
    'INSERT INTO zone_assign (zid, login, zone_role) VALUES ($1, $2, $3) ON CONFLICT (zid, login) DO UPDATE SET zone_role = $3',
    [zid, login, role],
  );
}

/** Set up a plan with two zones: one enabled, one public-view. Returns setup data. */
async function setupMixedEnabledPublicViewPlan(): Promise<{
  pid: number;
  enabledZid: number;
  viewZid: number;
  enabledSeatId: number;
  viewSeatId: number;
}> {
  const pid = await createPlan('Mixed Test Plan', 1);
  const enabledZid = await createZone('Enabled Zone', 20);
  const viewZid = await createZone('View-Only Zone', 30);
  const [enabledSeatId] = await addSeats(pid, enabledZid, ['E.1']);
  const [viewSeatId] = await addSeats(pid, viewZid, ['V.1']);

  // user2: user of enabled zone (can book there), no explicit role in view-only zone
  // (PUBLIC_VIEW gives implicit VIEWER access)
  await assignZoneRole(enabledZid, 'user2', 20);
  // admin gets both for good measure
  await assignZoneRole(enabledZid, 'admin', 10);
  await assignZoneRole(viewZid, 'admin', 10);

  return { pid, enabledZid, viewZid, enabledSeatId, viewSeatId };
}

/** Set up a plan with two zones: one enabled, one disabled. Returns setup data. */
async function setupMixedEnabledDisabledPlan(): Promise<{
  pid: number;
  enabledZid: number;
  disabledZid: number;
  enabledSeatId: number;
  disabledSeatId: number;
}> {
  const pid = await createPlan('Mixed Enabled+Disabled', 1);
  const enabledZid = await createZone('Enabled Zone 2', 20);
  const disabledZid = await createZone('Disabled Zone', 10);
  const [enabledSeatId] = await addSeats(pid, enabledZid, ['E2.1']);
  const [disabledSeatId] = await addSeats(pid, disabledZid, ['D.1']);

  // user2: user of enabled zone, admin of disabled zone
  await assignZoneRole(enabledZid, 'user2', 20);
  await assignZoneRole(disabledZid, 'user2', 10);
  // admin of both
  await assignZoneRole(enabledZid, 'admin', 10);
  await assignZoneRole(disabledZid, 'admin', 10);

  return { pid, enabledZid, disabledZid, enabledSeatId, disabledSeatId };
}

// ---------------------------------------------------------------------------
// PUBLIC_VIEW zones
// ---------------------------------------------------------------------------

test.describe('PUBLIC_VIEW zone (zone_type=30)', () => {

  test('viewer sees seats but cannot book via UI — action modal does not open', async ({ page }) => {
    // Make Zone 1A a public-view zone
    await setZoneType(1, 30);

    // user3 has no explicit role; PUBLIC_VIEW gives implicit VIEWER access
    await logIn(page, USER3);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const ts = await getFirstZoneDate(page, 1);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // Seat should be visible but not bookable — clicking should NOT open the action modal
    // For pure viewers, the action modal is not even rendered in the DOM.
    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await page.waitForTimeout(300);

    // The action modal must NOT be open
    const actionModal = page.locator('#action_modal');
    if (await actionModal.count() > 0) {
      await expect(actionModal).not.toHaveClass(/open/);
    }
    // If the modal doesn't exist at all (viewer mode), that's also correct.
  });

  test('unassigned user (viewer only) cannot book a PUBLIC_VIEW seat via API (code 104)', async ({ page }) => {
    await setZoneType(1, 30);

    // user3 has no explicit role — only gets VIEWER via PUBLIC_VIEW
    await logIn(page, USER3);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('admin of a PUBLIC_VIEW zone can still book', async ({ page }) => {
    await setZoneType(1, 30);

    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('unassigned user can view a PUBLIC_VIEW zone page', async ({ page }) => {
    await setZoneType(1, 30);

    // user3 has no zone assignment, but PUBLIC_VIEW gives VIEWER access
    await logIn(page, USER3);
    const resp = await page.request.get('/plan/1');
    expect(resp.status()).toBe(200);
  });

  test('viewer with an existing booking can still delete it', async ({ page }) => {
    await setZoneType(1, 30);

    // Insert a booking for user3 directly in the DB
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user3', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER3);
    const bookResult = await querySql(
      'SELECT id FROM book WHERE login = $1 AND sid = $2',
      ['user3', seat.id],
    );
    const bid = Number(bookResult.rows[0].id);

    // User3 should be able to delete their own booking even in a view-only zone
    const resp = await apiApply(page, { remove: [bid] });
    expect(resp.status()).toBe(200);

    // Verify the booking is gone
    const check = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1',
      [bid],
    );
    expect(check.rows[0].cnt).toBe(0);
  });

  test('user with explicit USER role in PUBLIC_VIEW zone can still book', async ({ page }) => {
    await setZoneType(1, 30);

    // user2 has explicit USER role via group_1a; effectiveZoneRole picks min(USER, VIEWER) = USER
    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    // user2 has explicit USER role, so they CAN book even in a PUBLIC_VIEW zone
    expect(resp.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// PUBLIC_BOOK zones
// ---------------------------------------------------------------------------

test.describe('PUBLIC_BOOK zone (zone_type=40)', () => {

  test('any authenticated user can book a PUBLIC_BOOK seat', async ({ page }) => {
    await setZoneType(1, 40);

    await logIn(page, USER3);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('user with explicit ADMIN role in a PUBLIC_BOOK zone can still book', async ({ page }) => {
    await setZoneType(1, 40);

    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// DISABLED zones
// ---------------------------------------------------------------------------

test.describe('DISABLED zone (zone_type=10)', () => {

  test('admin can view DISABLED zone seats but cannot book them (code 104)', async ({ page }) => {
    await setZoneType(1, 10);

    // user1 is admin of Zone 1A
    await logIn(page, USER1);
    const resp = await page.request.get('/plan/1');
    expect(resp.status()).toBe(200);

    // But booking should be forbidden even for admins
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const bookResp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(bookResp.status()).toBe(403);
    expect((await bookResp.json()).code).toBe(104);
  });

  test('non-admin user cannot access a DISABLED zone at all', async ({ page }) => {
    await setZoneType(1, 10);

    // user2 only has USER role in Zone 1A, which is now disabled
    await logIn(page, USER2);
    const resp = await page.request.get('/plan/1');
    expect(resp.status()).toBe(403);
  });

  test('system admin can view a DISABLED zone but still cannot book seats', async ({ page }) => {
    await setZoneType(1, 10);

    await logIn(page, ADMIN);
    const resp = await page.request.get('/plan/1');
    expect(resp.status()).toBe(200);

    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const bookResp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(bookResp.status()).toBe(403);
    expect((await bookResp.json()).code).toBe(104);
  });

  test('admin of DISABLED zone sees seats as non-bookable in getSeats response', async ({ page }) => {
    await setZoneType(1, 10);

    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    // All seats should have bookable: false
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(false);
      }
    }
  });

  test('autoBook is rejected when only DISABLED zones exist on the plan', async ({ page }) => {
    await setZoneType(1, 10);

    await logIn(page, USER1);
    const ts = futureDayTs(1);
    const resp = await page.request.post('/xhr/zone/autoBook/1', {
      data: { dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Mixed-zone plans
// ---------------------------------------------------------------------------

test.describe('mixed-zone plan: ENABLED + PUBLIC_VIEW', () => {

  test('user sees enabled-zone seats as bookable and view-zone seats as non-bookable', async ({ page }) => {
    const { pid, enabledSeatId, viewSeatId } = await setupMixedEnabledPublicViewPlan();

    await logIn(page, USER2);
    const resp = await page.request.get(`/xhr/zone/getSeats/${pid}`);
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    // Enabled zone seat: bookable=true
    expect(data.seats[String(enabledSeatId)].bookable).toBe(true);
    // View-only zone seat: bookable=false (user2 has no explicit role → VIEWER)
    expect(data.seats[String(viewSeatId)].bookable).toBe(false);
  });

  test('user can book in the enabled zone but not in the view-only zone', async ({ page }) => {
    const { pid, enabledSeatId, viewSeatId } = await setupMixedEnabledPublicViewPlan();

    await logIn(page, USER2);
    const ts = futureDayTs(1);

    // Can book in enabled zone
    const resp1 = await apiApply(page, {
      book: { sid: enabledSeatId, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp1.status()).toBe(200);

    // Cannot book in view-only zone
    const resp2 = await apiApply(page, {
      book: { sid: viewSeatId, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp2.status()).toBe(403);
    expect((await resp2.json()).code).toBe(104);
  });

  test('clicking a view-only seat on the zone map does not open action modal', async ({ page }) => {
    const { pid, viewSeatId } = await setupMixedEnabledPublicViewPlan();

    await logIn(page, USER2);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);

    const ts = await getFirstZoneDate(page, pid);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // Click the view-only zone seat — should NOT open action modal
    const viewSeats = await querySql(
      'SELECT id, name, x, y FROM seat WHERE id = $1',
      [viewSeatId],
    );
    const vs = viewSeats.rows[0];
    await page.locator('#zonemap').click({
      position: { x: Number(vs.x) + 24, y: Number(vs.y) + 24 },
    });
    await page.waitForTimeout(300);
    await expect(page.locator('#action_modal')).not.toHaveClass(/open/);
  });
});

test.describe('mixed-zone plan: ENABLED + DISABLED', () => {

  test('admin of disabled zone sees its seats as non-bookable', async ({ page }) => {
    const { pid, enabledSeatId, disabledSeatId } = await setupMixedEnabledDisabledPlan();

    await logIn(page, USER2);
    const resp = await page.request.get(`/xhr/zone/getSeats/${pid}`);
    expect(resp.status()).toBe(200);
    const data = await resp.json();

    expect(data.seats[String(enabledSeatId)].bookable).toBe(true);
    expect(data.seats[String(disabledSeatId)].bookable).toBe(false);
  });

  test('admin of disabled zone cannot book seats there even via API', async ({ page }) => {
    const { disabledSeatId } = await setupMixedEnabledDisabledPlan();

    await logIn(page, USER2);
    const ts = futureDayTs(1);

    const resp = await apiApply(page, {
      book: { sid: disabledSeatId, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('can still book in the enabled zone on the same plan', async ({ page }) => {
    const { enabledSeatId } = await setupMixedEnabledDisabledPlan();

    await logIn(page, USER2);
    const ts = futureDayTs(1);

    const resp = await apiApply(page, {
      book: { sid: enabledSeatId, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Plan-level viewer detection (isZoneViewer)
// ---------------------------------------------------------------------------

test.describe('plan with all view-only zones → isZoneViewer', () => {

  test('user with only VIEWER access to all zones on a plan gets viewer mode', async ({ page }) => {
    // Make Zone 1A public-view — user2 was USER via group_1a before.
    // Remove group membership and assign as viewer only.
    await setZoneType(1, 30);
    await querySql("DELETE FROM groups WHERE login = 'user2'");
    await assignZoneRole(1, 'user2', 30);

    await logIn(page, USER2);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    // The action modal HTML should not exist (viewer mode hides it)
    await expect(page.locator('#action_modal')).toHaveCount(0);

    // Auto-book FAB should not exist either
    await expect(page.locator('#auto_book_btn')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// getSeats API: bookable flag
// ---------------------------------------------------------------------------

test.describe('getSeats bookable flag', () => {

  test('ENABLED zone seats have bookable=true for users', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) { // accessible seats only
        expect(data.seats[sid].bookable).toBe(true);
      }
    }
  });

  test('PUBLIC_VIEW zone seats have bookable=false for viewers (no explicit role)', async ({ page }) => {
    await setZoneType(1, 30);

    // user3 has no explicit role → gets VIEWER via PUBLIC_VIEW
    await logIn(page, USER3);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(false);
      }
    }
  });

  test('PUBLIC_VIEW zone seats have bookable=true for admins (explicit ADMIN role)', async ({ page }) => {
    await setZoneType(1, 30);

    // admin has explicit ADMIN role; effectiveZoneRole picks min(ADMIN, VIEWER) = ADMIN
    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(true);
      }
    }
  });

  test('PUBLIC_BOOK zone seats have bookable=true for everyone', async ({ page }) => {
    await setZoneType(1, 40);

    await logIn(page, USER3);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(true);
      }
    }
  });

  test('DISABLED zone seats have bookable=false even for admins', async ({ page }) => {
    await setZoneType(1, 10);

    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(false);
      }
    }
  });

  test('conflict-only seats (inaccessible zones) do not have bookable field', async ({ page }) => {
    const pid = await createPlan('Conflict Test Plan', 1);
    const zid1 = await createZone('Conflict Zone A', 20);
    const zid2 = await createZone('Conflict Zone B', 20);
    await addSeats(pid, zid1, ['CA.1']);
    await addSeats(pid, zid2, ['CB.1']);

    await assignZoneRole(zid1, 'user2', 20);
    // user2 has no access to zid2

    await logIn(page, USER2);
    const resp = await page.request.get(`/xhr/zone/getSeats/${pid}`);
    const data = await resp.json();
    for (const sid in data.seats) {
      const seat = data.seats[sid];
      if (seat.x === undefined) {
        // Conflict-only seat from inaccessible zone — no bookable field
        expect(seat.bookable).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Effective zone role semantics
// ---------------------------------------------------------------------------

test.describe('effectiveZoneRole semantics', () => {

  test('PUBLIC_VIEW + explicit USER role → USER (bookable)', async ({ page }) => {
    await setZoneType(1, 30);
    // user2 has explicit USER role via group_1a; PUBLIC_VIEW gives VIEWER,
    // effectiveZoneRole picks min(USER, VIEWER) = USER → bookable
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(true);
      }
    }
  });

  test('PUBLIC_BOOK + no explicit role → USER (bookable)', async ({ page }) => {
    await setZoneType(1, 40);
    // Remove user3's assignments entirely — they have no explicit role
    // PUBLIC_BOOK gives USER to everyone → bookable
    await logIn(page, USER3);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    const data = await resp.json();
    for (const sid in data.seats) {
      if (data.seats[sid].x !== undefined) {
        expect(data.seats[sid].bookable).toBe(true);
      }
    }
  });

  test('DISABLED + explicit ADMIN role → no booking allowed', async ({ page }) => {
    await setZoneType(1, 10);
    // user1 is admin of Zone 1A — disabled zone still denies booking
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
  });

  test('ENABLED + explicit VIEWER role → no booking allowed', async ({ page }) => {
    // Zone 1A is ENABLED (20), user2 gets explicit VIEWER role
    await querySql("DELETE FROM groups WHERE login = 'user2'");
    await assignZoneRole(1, 'user2', 30);

    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });
});
