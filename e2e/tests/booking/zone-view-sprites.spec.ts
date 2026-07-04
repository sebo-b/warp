/**
 * Phase 2 display-fix sprite assertions (PLAN_VIEW_ONLY_SEATS.md "Phase 2 test
 * plan"). These lock down the core invariant of the view-only-zone fix: in a
 * view-only zone the user sees real occupancy/assignment icons (taken /
 * assigned / yours), and `bookable: false` only demotes the *action* states
 * (book → unavailable). Without these, a future refactor could revert
 * viewer-zone seats to a uniform `unavailable` and no e2e would catch it — the
 * bookings/permission specs only assert action-button visibility, never the
 * rendered sprite.
 *
 * Sprite cell names come from js/views/modules/seat.js `spriteFor`:
 *   taken, assigned, unavailable, yours, available, rebook, availableAssigned
 * Asserted via the active `<use>` href on `#sprite-<sid>` (OfficeMap keeps one
 * `<use>` per distinct cell name and toggles `display` to switch — see
 * expectSprite below; same pattern as e2e/tests/officemap/officemap.spec.ts).
 *
 * Setup rule: seed all DB state (bookings, assignments) BEFORE navigating to the
 * plan — getSeats runs on mount and the seat data is fixed then; selecting a
 * date only recomputes state from already-loaded data, it does not re-fetch.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  selectOnlyDates,
  waitForSeatsLoaded,
  clickActionBtn,
} from '../../helpers/booking';
import {
  ZONE_TYPE_ENABLED,
  ZONE_TYPE_PUBLIC_VIEW,
  ZONE_ROLE_USER,
  ZONE_ROLE_ADMIN,
  createPlan,
  createZone,
  addSeats,
  assignZoneRole,
  assignSeat,
  insertBooking,
} from '../../helpers/zone-setup';

/** Assert the seat's ACTIVE sprite <use> href ends in #cell-<expected>.
 * OfficeMap keeps one <use> per distinct cell name and toggles `display` to
 * switch sprites (it never mutates href or removes old uses, to avoid a
 * re-resolve blink). So a seat that started `unavailable` then became `taken`
 * has two <use> children — only the active one has `display !== 'none'`.
 * Auto-retries via expect.poll until the right sprite is active. */
async function expectSprite(page: any, seatId: number, cell: string) {
  await expect.poll(async () => {
    return await page.evaluate((id) => {
      const glyph = document.querySelector(`#sprite-${id} .OMSeatGlyph`);
      if (!glyph) return null;
      for (const u of glyph.querySelectorAll('use')) {
        if (u.style.display !== 'none') return u.getAttribute('href');
      }
      return null;
    }, seatId);
  }).toMatch(RegExp(`#${cell}$`));
}

/** Click a seat and assert the action modal does NOT open. For a pure viewer
 * (isZoneViewer) the modal is removed from the DOM entirely; for a mixed-plan
 * user it exists but must stay closed. Both are correct "no action" outcomes. */
async function clickExpectsNoModal(page: any, seatId: number) {
  await page.locator(`#sprite-${seatId}`).click();
  await page.waitForTimeout(300);
  const modal = page.locator('#action_modal');
  if (await modal.count() > 0) {
    await expect(modal).not.toHaveClass(/open/);
  }
}

/** A 09:00–17:00 slot for the default-slider day (tomorrow). */
const DAY = futureDayTs(1);
function slot() {
  return { fromTS: DAY + 9 * 3600, toTS: DAY + 17 * 3600 };
}

/** Set the plan time-slider range via the HH:MM edit boxes (fires `change`,
 * which the app maps to a noUiSlider.set). Used to test pure-shrink vs extend
 * selections against a seeded own booking. */
async function setSliderTimes(page: any, lo: string, hi: string) {
  const minInput = page.locator('#timeslider-min');
  const maxInput = page.locator('#timeslider-max');
  await minInput.fill('');
  await minInput.fill(lo);
  await minInput.dispatchEvent('change');
  await maxInput.fill('');
  await maxInput.fill(hi);
  await maxInput.dispatchEvent('change');
  await page.waitForTimeout(200);
}

// ---------------------------------------------------------------------------
// Viewer zone (PUBLIC_VIEW): informational icons survive, action icon demoted
// ---------------------------------------------------------------------------

test.describe('view-only zone: informational icons survive, action icon demoted', () => {
  /** Plan with one PUBLIC_VIEW zone + 4 seats; user3 is an implicit viewer. */
  async function setupViewZone() {
    const pid = await createPlan('Sprite View Plan', 1);
    const zid = await createZone('Sprite View Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [sTaken, sAssigned, sEveryone, sFree] = await addSeats(pid, zid, [
      'SV.taken', 'SV.assigned', 'SV.everyone', 'SV.free',
    ]);
    return { pid, zid, sTaken, sAssigned, sEveryone, sFree };
  }

  test('1. seat booked by another user → taken; click opens no modal', async ({ page }) => {
    const { pid, sTaken } = await setupViewZone();
    const { fromTS, toTS } = slot();
    await insertBooking(USER1.login, sTaken, fromTS, toTS);

    await logIn(page, USER3);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    await expectSprite(page, sTaken, 'cell-taken');
    await clickExpectsNoModal(page, sTaken);
  });

  test('2. seat assigned to another user, free → assigned', async ({ page }) => {
    const { pid, sAssigned } = await setupViewZone();
    await assignSeat(sAssigned, USER1.login, null);

    await logIn(page, USER3);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    await expectSprite(page, sAssigned, 'cell-assigned');
  });

  test('3. seat with everyone-assignment only, free → unavailable', async ({ page }) => {
    const { pid, sEveryone } = await setupViewZone();
    await assignSeat(sEveryone, null, null); // everyone-only, no named assignee

    await logIn(page, USER3);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    // Everyone-only carries no person info for a non-booker → falls through to
    // CAN_BOOK → demoted to VIEW_ONLY → unavailable.
    await expectSprite(page, sEveryone, 'cell-unavailable');
  });

  test('4. free unassigned seat → unavailable; click opens no modal', async ({ page }) => {
    const { pid, sFree } = await setupViewZone();

    await logIn(page, USER3);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    await expectSprite(page, sFree, 'cell-unavailable');
    await clickExpectsNoModal(page, sFree);
  });
});

// ---------------------------------------------------------------------------
// Own booking in a view-only zone: release still works via the modal
// ---------------------------------------------------------------------------

test.describe('own booking in a view-only zone', () => {
  test('5. own booking exact match → yours; delete via modal works', async ({ page }) => {
    // Mixed plan so the user is NOT a pure viewer (isZoneViewer false → the
    // action modal exists in the DOM). user3 is USER in the enabled zone and an
    // implicit viewer in the PUBLIC_VIEW zone; their own booking is on the
    // view-only seat. CAN_DELETE_EXACT is informational (not demoted by
    // !bookable) → sprite `yours`, and release is offered (apply()'s remove
    // bypasses the zone-admin check for own bookings).
    const pid = await createPlan('Sprite Own Plan', 1);
    const enabledZid = await createZone('SO Enabled', ZONE_TYPE_ENABLED);
    const viewZid = await createZone('SO View', ZONE_TYPE_PUBLIC_VIEW);
    const [enabledSeat] = await addSeats(pid, enabledZid, ['SO.enabled']);
    const [viewSeat] = await addSeats(pid, viewZid, ['SO.view']);
    await assignZoneRole(enabledZid, 'user3', ZONE_ROLE_USER);

    const { fromTS, toTS } = slot();
    await insertBooking(USER3.login, viewSeat, fromTS, toTS);

    await logIn(page, USER3);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    await expectSprite(page, viewSeat, 'cell-yours');

    await page.locator(`#sprite-${viewSeat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'delete');

    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, viewSeat],
    );
    expect(r.rows[0].cnt).toBe(0);
    // enabledSeat stays bookable (untouched) — sanity that the mixed plan held.
    await expectSprite(page, enabledSeat, 'cell-available');
  });
});

// ---------------------------------------------------------------------------
// Pure viewer (isZoneViewer): the action modal is kept in the DOM so an own
// booking can be released from the plan map, but non-actionable seats open no
// modal. (Counterpart to test 5, which uses a mixed plan so isZoneViewer is
// false; here the user has ONLY view-only access.)
// ---------------------------------------------------------------------------

test.describe('pure viewer releasing own booking from the plan map', () => {
  test('9. pure viewer: own booking -> yours + release works; free/TAKEN open no modal', async ({ page }) => {
    const pid = await createPlan('Sprite Pure Viewer Plan', 1);
    const zid = await createZone('SPV Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [ownSeat, freeSeat, takenSeat] = await addSeats(pid, zid, ['SPV.own', 'SPV.free', 'SPV.taken']);
    const { fromTS, toTS } = slot();
    await insertBooking(USER3.login, ownSeat, fromTS, toTS);
    await insertBooking(USER1.login, takenSeat, fromTS, toTS);

    await logIn(page, USER3);            // user3 has no explicit role -> pure viewer
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    // Own booking -> yours; the other two are non-actionable for a viewer.
    await expectSprite(page, ownSeat, 'cell-yours');
    await expectSprite(page, freeSeat, 'cell-unavailable');
    await expectSprite(page, takenSeat, 'cell-taken');

    // Non-actionable seats must NOT open the bottom-sheet panel.
    await clickExpectsNoModal(page, freeSeat);
    await clickExpectsNoModal(page, takenSeat);

    // Own booking -> Release modal -> booking gone (apply() remove bypasses the
    // zone-admin check for own bookings).
    await page.locator(`#sprite-${ownSeat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'delete');
    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, ownSeat],
    );
    expect(r.rows[0].cnt).toBe(0);
  });

  test('10. pure viewer: own booking with non-matching time stays blue (yoursChange), release works', async ({ page }) => {
    // user3's booking is seeded at 10:00-16:00; the default slider selects
    // 09:00-17:00, so the booking overlaps but is NOT an exact match. CAN_CHANGE
    // is no longer demoted for !bookable seats (Phase 3B): the seat shows the
    // blue "yoursChange" icon. The selection extends beyond the booking on both
    // sides, so it is NOT a pure shrink → Update is not offered, only Release.
    const pid = await createPlan('Sprite NonExact Plan', 1);
    const zid = await createZone('SNE Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [ownSeat] = await addSeats(pid, zid, ['SNE.1']);
    await insertBooking(USER3.login, ownSeat, DAY + 10 * 3600, DAY + 16 * 3600);

    await logIn(page, USER3);            // pure viewer
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);   // default slider 09:00-17:00
    await page.waitForTimeout(400);

    // Non-exact own booking -> blue "yoursChange" (NOT grey "taken", not plain
    // "yours" — the arrows signal the booking can change, and a shrink would).
    await expectSprite(page, ownSeat, 'cell-yoursChange');

    // Update is NOT offered (selection extends beyond the booking -> not a pure
    // shrink); Release still works end-to-end.
    await page.locator(`#sprite-${ownSeat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="update"]')).not.toBeVisible();
    await clickActionBtn(page, 'delete');
    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, ownSeat],
    );
    expect(r.rows[0].cnt).toBe(0);
  });

  test('12. pure viewer: shrink own booking through the modal (Update offered + works; extend offers Release only)', async ({ page }) => {
    // Phase 3B/3C: a pure shrink of an own booking is always allowed, even in a
    // view-only zone. user3's booking is seeded at 09:00-17:00; narrowing the
    // slider to 10:00-16:00 (fully contained) -> cell-yoursChange, modal offers
    // Release AND Update, Update succeeds (apply() is_pure_shrink bypass) and
    // the booking becomes 10:00-16:00. Then widening the slider back to
    // 09:00-17:00 (extends beyond the now-10:00-16:00 booking) -> Release only.
    const pid = await createPlan('Sprite Shrink Plan', 1);
    const zid = await createZone('SS Zone', ZONE_TYPE_PUBLIC_VIEW);
    const [ownSeat] = await addSeats(pid, zid, ['SS.1']);
    await insertBooking(USER3.login, ownSeat, DAY + 9 * 3600, DAY + 17 * 3600);

    await logIn(page, USER3);            // pure viewer
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await setSliderTimes(page, '10:00', '16:00');
    await page.waitForTimeout(400);

    // Contained selection -> yoursChange, and Update is offered (pure shrink).
    await expectSprite(page, ownSeat, 'cell-yoursChange');
    await page.locator(`#sprite-${ownSeat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="update"]')).toBeVisible();
    await clickActionBtn(page, 'update');

    // Booking replaced: 10:00-16:00 now.
    const after = await querySql(
      'SELECT fromts::int AS f, tots::int AS t FROM book WHERE login = $1 AND sid = $2',
      [USER3.login, ownSeat],
    );
    expect(after.rows.length).toBe(1);
    expect(after.rows[0].f).toBe(DAY + 10 * 3600);
    expect(after.rows[0].t).toBe(DAY + 16 * 3600);

    // Now widen the slider beyond the booking -> not a shrink -> Release only.
    await setSliderTimes(page, '09:00', '17:00');
    await page.waitForTimeout(400);
    await expectSprite(page, ownSeat, 'cell-yoursChange');
    await page.locator(`#sprite-${ownSeat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="update"]')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Risk #1 guard: conflict map across a mixed ENABLED + PUBLIC_VIEW zone_group
// ---------------------------------------------------------------------------

test.describe('mixed ENABLED + PUBLIC_VIEW in one zone_group (risk #1 guard)', () => {
  test('6. viewer-zone taken stays taken; enabled-zone free shows rebook', async ({ page }) => {
    const pid = await createPlan('Sprite Mixed Plan', 1);
    const enabledZid = await createZone('SM Enabled', ZONE_TYPE_ENABLED, 'smGrp');
    const viewZid = await createZone('SM View', ZONE_TYPE_PUBLIC_VIEW, 'smGrp');
    const [enabledOwn, enabledFree] = await addSeats(pid, enabledZid, ['SM.own', 'SM.free']);
    const [viewTaken] = await addSeats(pid, viewZid, ['SM.taken']);
    await assignZoneRole(enabledZid, 'user2', ZONE_ROLE_USER);

    const { fromTS, toTS } = slot();
    // user2 holds enabledOwn (exact match); user1 holds viewTaken (foreign).
    await insertBooking(USER2.login, enabledOwn, fromTS, toTS);
    await insertBooking(USER1.login, viewTaken, fromTS, toTS);

    await logIn(page, USER2);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    // The viewer-zone TAKEN seat must stay `taken` — not be demoted to
    // unavailable, and must NOT suppress the same-group rebook in the enabled
    // zone (isMine=false for the foreign booking → no conflict-map entry).
    await expectSprite(page, viewTaken, 'cell-taken');
    // user2's own same-group booking makes enabledFree a rebook.
    await expectSprite(page, enabledFree, 'cell-rebook');
    // Own exact booking → yours.
    await expectSprite(page, enabledOwn, 'cell-yours');
  });
});

// ---------------------------------------------------------------------------
// Risk #5 guard: assigned-to-me in a bookable ENABLED zone stays availableAssigned
// ---------------------------------------------------------------------------

test.describe('assigned-to-me in a bookable ENABLED zone (risk #5 guard)', () => {
  test('7. seat assigned to me, within window, free → availableAssigned', async ({ page }) => {
    const pid = await createPlan('Sprite AssignMe Plan', 1);
    const zid = await createZone('SAM Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['SAM.1']);
    await assignZoneRole(zid, 'user2', ZONE_ROLE_USER);
    // Assigned to user2, unlimited days_in_advance → within window → falls
    // through to CAN_BOOK (not ASSIGNED), with assignedToMe → availableAssigned.
    await assignSeat(seat, USER2.login, null);

    await logIn(page, USER2);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    await expectSprite(page, seat, 'cell-availableAssigned');
  });
});

// ---------------------------------------------------------------------------
// Book-for override of an assignment: admin books FOR a target onto a seat
// assigned to someone else (apply() skips 106/110 under is_book_for). The
// seat is bookable despite the assignment, so it renders the plain green
// "available" icon (third-party assignment) or blue "availableAssigned"
// (assigned to the target, beyond its window) — no special override glyph.
// ---------------------------------------------------------------------------

/** Activate book-for for the given display label (e.g. "Bar [user2]"). */
async function activateBookFor(page: any, label: string): Promise<void> {
  const bookForInput = page.locator('#book-for');
  await bookForInput.click();
  await bookForInput.pressSequentially(label.split(' ')[0], { delay: 50 });
  const item = page.locator('ul.autocomplete-content li', { hasText: label });
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

test.describe('book-for override of an assignment', () => {
  test('8. seat assigned to a third person, book-for target is a member → available + book works', async ({ page }) => {
    const pid = await createPlan('Sprite Override Plan', 1);
    const zid = await createZone('SO Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['SO.1']);
    // user1 administers the zone; user2 (the book-for target) is a member;
    // the seat is assigned to user3 (a third person, not the target).
    await assignZoneRole(zid, USER1.login, ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, USER2.login, ZONE_ROLE_USER);
    await assignSeat(seat, USER3.login, null);

    await logIn(page, USER1);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    // Default self-view (admin): the seat is bookable at the zone level but
    // self-book is blocked by 106 → grey ASSIGNED.
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);
    await expectSprite(page, seat, 'cell-assigned');

    // Switch to book-for user2: the admin may now override the assignment →
    // plain green `available` (third-party assignment), and the book action
    // books for user2.
    await activateBookFor(page, `${USER2.name} [${USER2.login}]`);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);
    await expectSprite(page, seat, 'cell-available');

    await page.locator(`#sprite-${seat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'book');

    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      [USER2.login, seat],
    );
    expect(r.rows[0].cnt).toBe(1);
  });

  test('8b. seat assigned to the target beyond its window, book-for → availableAssigned', async ({ page }) => {
    // The seat is assigned to user2 (the book-for target) with days_in_advance
    // = 0, so the default tomorrow slot is beyond the target's window. Self-view
    // (admin user1) is not the assignee → grey ASSIGNED; under book-for user2
    // the window is overridden and the seat falls through to CAN_BOOK with
    // assignedToMe → blue `availableAssigned`.
    const pid = await createPlan('Sprite Override Target Plan', 1);
    const zid = await createZone('SOT Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['SOT.1']);
    await assignZoneRole(zid, USER1.login, ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, USER2.login, ZONE_ROLE_USER);
    await assignSeat(seat, USER2.login, 0);

    await logIn(page, USER1);
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);
    await expectSprite(page, seat, 'cell-assigned');

    await activateBookFor(page, `${USER2.name} [${USER2.login}]`);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);
    await expectSprite(page, seat, 'cell-availableAssigned');
  });
});

// ---------------------------------------------------------------------------
// Zone admin releasing another user's booking from the plan map. The seat is
// TAKEN (foreign booking); a zone admin who administers the seat's zone may
// release it directly (apply()'s remove requires per-seat zone-admin for
// foreign bookings). Non-admins get no action (TAKEN stays informational).
// ---------------------------------------------------------------------------

test.describe('zone admin releasing another user booking from the plan map', () => {
  test('11. admin clicks a foreign-booked seat -> Release works; non-admin gets no modal', async ({ page }) => {
    const pid = await createPlan('Sprite ForeignRelease Plan', 1);
    const zid = await createZone('FR Zone', ZONE_TYPE_ENABLED);
    const [seat] = await addSeats(pid, zid, ['FR.1']);
    await assignZoneRole(zid, USER1.login, ZONE_ROLE_ADMIN);
    await assignZoneRole(zid, USER2.login, ZONE_ROLE_USER);
    const { fromTS, toTS } = slot();
    await insertBooking(USER2.login, seat, fromTS, toTS);   // foreign to user1

    await logIn(page, USER1);             // admin of the zone
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);

    // The seat is TAKEN (foreign booking).
    await expectSprite(page, seat, 'cell-taken');

    // Admin -> Release modal (delete offered, book not).
    await page.locator(`#sprite-${seat}`).click();
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.plan_action_btn[data-action="delete"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="book"]')).not.toBeVisible();
    // The to-be-released row names the foreign owner.
    await expect(page.locator('#action_modal_msg2')).toContainText(USER2.name);
    await clickActionBtn(page, 'delete');

    const r = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      [USER2.login, seat],
    );
    expect(r.rows[0].cnt).toBe(0);

    // A non-admin clicking a foreign-booked seat gets no modal (TAKEN is
    // informational for non-admins).
    await logIn(page, USER2);             // USER in the zone, but the booking is gone
    await page.goto(`/plan/${pid}`);
    await waitForSeatsLoaded(page);
    await insertBooking(USER1.login, seat, fromTS, toTS);  // now booked by user1 (foreign to user2)
    await page.reload();
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [DAY]);
    await page.waitForTimeout(400);
    await page.locator(`#sprite-${seat}`).click();
    await page.waitForTimeout(300);
    await expect(page.locator('#action_modal')).not.toHaveClass(/open/);
  });
});