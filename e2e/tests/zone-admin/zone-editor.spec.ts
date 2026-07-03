/**
 * Plan editor tests: /plans/modify/{pid}
 *
 * The editor is split into tabs (#plan_modify_tabs): Transform / Add mode / Map edit.
 *   Transform (default) = click seats to select, drag to move, marquee-transform
 *   Add mode            = click the map image to place a new seat
 *   Map edit            = replace the map image / tune the dark-mode filter
 *
 * toggleMode() flips between the Transform and Add mode tabs for the seat-editing
 * tests below.
 *
 * Translated summary strings (en.json smart_count pluralisation):
 *   - added one seat / added N seats
 *   - updated data of a seat / updated data of N seats
 *   - deleted a seat / deleted N seats
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { getZoneSeats } from '../../helpers/booking';

const ZID = 1;

// Where to click when adding a new seat. Must not overlap any sample-data
// seat sprite (48×48 starting at the seat's x/y): sprites are siblings of the
// map image, so a click landing on one never reaches the image's add-seat
// handler. (600,150) is empty on the 1132×629 zone-1 map.
const EMPTY_SPOT = { x: 600, y: 150 };

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function openEditor(page: import('@playwright/test').Page, zid = ZID): Promise<void> {
  await page.goto(`/plans/modify/${zid}?return=/plans`);
  await expect(page.locator('#zone_map')).toBeVisible();
  await expect(page.locator('#saveBtn')).toBeAttached();
  await page.waitForLoadState('networkidle');
}

/** Click a seat at its centre — works in the Transform and Add mode tabs. */
async function selectSeat(
  page: import('@playwright/test').Page,
  seat: { x: number; y: number },
): Promise<void> {
  await page.locator('#zone_map_container').click({
    position: { x: seat.x + 24, y: seat.y + 24 },
  });
  await expect(page.locator('#seat_edit_panel')).toBeVisible();
}

/** Toggle the editor between the Transform and Add mode tabs (preserving the
 *  old Edit↔Add switch semantics the seat-editing tests rely on). */
async function toggleMode(page: import('@playwright/test').Page): Promise<void> {
  const inAddMode = await page.locator('#plan_modify_tabs a.active', { hasText: 'Add mode' }).count() > 0;
  const target = inAddMode ? 'Transform' : 'Add mode';
  await page.locator('#plan_modify_tabs a', { hasText: target }).click();
  await expect(page.locator('#plan_modify_tabs a.active', { hasText: target })).toBeVisible();
}

async function saveAndConfirm(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);
  await page.locator('#saveBtn').click();
  const modal = page.locator('.modal.open', { hasText: /update the plan/ });
  await expect(modal).toBeVisible();
  // Click Yes and wait for the modify POST to actually commit before checking
  // the URL. (The editor URL `/plans/modify/<id>?return=/plans` ends with
  // `/plans`, so a bare toHaveURL(/\/plans$/) would falsely match it and return
  // before the save landed — a race the 1.x modal-close timing masked.)
  const modifyResp = page.waitForResponse(r => r.url().includes('/xhr/plans/modify') && r.request().method() === 'POST');
  await modal.locator('button', { hasText: /Yes/i }).click();
  await modifyResp;
  await expect(page).toHaveURL(/\/plans$/);
}

// ─── Access ───────────────────────────────────────────────────────────────────

test.describe('zone editor access', () => {

  test('admin can access the zone editor', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);
    await expect(page.locator('#saveBtn')).toBeAttached();
    await expect(page.locator('#plan_modify_tabs')).toBeVisible();
  });

  test('non-site-admin is forbidden from the zone editor', async ({ page }) => {
    await logIn(page, USER1); // zone admin but not site admin
    const resp = await page.request.get(`/plans/modify/${ZID}`);
    expect(resp.status()).toBe(403);
  });

  test('zone editor shows existing seats', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);
    const count = await page.locator('#zone_map_container > div.seat-icon').count();
    expect(count).toBe(seats.length);
  });

});

// ─── Select and edit ──────────────────────────────────────────────────────────

test.describe('selecting and editing a seat', () => {

  test('clicking a seat opens the edit panel with its data', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    await expect(page.locator('#seat_name')).toHaveValue(seat.name);
    await expect(page.locator('#seat_x')).toHaveValue(String(seat.x));
    await expect(page.locator('#seat_y')).toHaveValue(String(seat.y));
  });

  test('changing seat name shows correct summary ("updated data of a seat")', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    await page.locator('#seat_name').fill('NewNameXYZ');
    await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);

    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('updated data of a seat');
    await modal.locator('button', { hasText: /No/i }).click();
  });

  test('renaming a seat persists to DB', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    const newName = 'Renamed-' + Date.now();
    await page.locator('#seat_name').fill(newName);
    await saveAndConfirm(page);

    const result = await querySql('SELECT name FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].name).toBe(newName);
  });

  test('moving seat via x/y inputs persists new coordinates', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    const newX = seat.x + 10;
    const newY = seat.y + 10;
    await page.locator('#seat_x').fill(String(newX));
    await page.locator('#seat_y').fill(String(newY));
    await saveAndConfirm(page);

    const result = await querySql('SELECT x, y FROM seat WHERE id = $1', [seat.id]);
    expect(Number(result.rows[0].x)).toBe(newX);
    expect(Number(result.rows[0].y)).toBe(newY);
  });

  test('selecting a seat focuses the name field', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);
    await expect(page.locator('#seat_name')).toBeFocused();
  });

});

// ─── Delete ───────────────────────────────────────────────────────────────────

test.describe('deleting a seat', () => {

  test('clicking Delete marks seat for deletion (button turns green)', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    await expect(page.locator('#seat_delete_btn')).toContainText(/Delete/i);
    await page.locator('#seat_delete_btn').click();
    await expect(page.locator('#seat_delete_btn')).toHaveClass(/green/);
    await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);
  });

  test('save summary shows "deleted a seat"', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);
    await page.locator('#seat_delete_btn').click();

    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).toContainText('deleted a seat');
    await modal.locator('button', { hasText: /No/i }).click();
  });

  test('confirming delete removes seat from DB', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    const seat = seats[seats.length - 1];

    await openEditor(page);
    await selectSeat(page, seat);
    await page.locator('#seat_delete_btn').click();
    await saveAndConfirm(page);

    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('delete can be undone (Restore) before saving', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    await page.locator('#seat_delete_btn').click();
    await expect(page.locator('#seat_delete_btn')).toHaveClass(/green/);

    // Restore — button goes back to red
    await page.locator('#seat_delete_btn').click();
    await expect(page.locator('#seat_delete_btn')).toHaveClass(/red/);

    // Make another change to keep saveBtn enabled, then verify summary has no deletion
    await page.locator('#seat_name').fill(seat.name + '~');
    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).not.toContainText('deleted');
    await modal.locator('button', { hasText: /No/i }).click();
  });

});

// ─── Add seats ────────────────────────────────────────────────────────────────

test.describe('adding a seat', () => {

  test('toggling between tabs changes the active editor mode', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    const transformTab = page.locator('#plan_modify_tabs a', { hasText: 'Transform' });
    const addTab = page.locator('#plan_modify_tabs a', { hasText: 'Add mode' });

    await expect(transformTab).toHaveClass(/active/); // Transform is the default tab
    await toggleMode(page); // → add mode
    await expect(addTab).toHaveClass(/active/);
    await toggleMode(page); // → back to transform
    await expect(transformTab).toHaveClass(/active/);
  });

  test('clicking map in add mode creates a new seat div', async ({ page }) => {
    await logIn(page, ADMIN);
    const beforeCount = (await getZoneSeats(ZID)).length;
    await openEditor(page);

    await toggleMode(page); // add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    const count = await page.locator('#zone_map_container > div.seat-icon').count();
    expect(count).toBe(beforeCount + 1);
    await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);
  });

  test('new seat named and saved appears in DB', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    // Add mode → click map
    await toggleMode(page);
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    // Switch back to edit mode to select the new seat (centred at click point)
    await toggleMode(page);
    await page.locator('#zone_map_container').click({ position: EMPTY_SPOT });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();

    await page.locator('#seat_name').fill('TestSeatNew');
    await saveAndConfirm(page);

    const result = await querySql("SELECT name FROM seat WHERE zid = $1 AND name = 'TestSeatNew'", [ZID]);
    expect(result.rows).toHaveLength(1);
  });

  test('save summary shows "added one seat"', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    await toggleMode(page);
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).toContainText('added one seat');
    await modal.locator('button', { hasText: /No/i }).click();
  });

  test('adding a seat focuses the name field for immediate typing', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    await toggleMode(page);                                  // → Add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    await expect(page.locator('#seat_edit_panel')).toBeVisible();
    await expect(page.locator('#seat_name')).toBeFocused();

    // Placeholder text is selected → typing replaces it (no manual clear).
    await page.keyboard.type('TypedName');
    await expect(page.locator('#seat_name')).toHaveValue('TypedName');
  });

  test('add mode keeps the edit panel directly below the zone dropdown', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    await toggleMode(page);                                  // → Add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();

    const dropdown = await page.locator('#add_seat_zone_selector').boundingBox();
    const panel = await page.locator('#seat_edit_panel').boundingBox();
    expect(dropdown).not.toBeNull();
    expect(panel).not.toBeNull();

    // The panel should start just below the dropdown, not floating in the middle.
    const gap = panel!.y - (dropdown!.y + dropdown!.height);
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThanOrEqual(40);   // tolerance for normal margins/padding
  });

  test('re-selecting a renamed added seat places caret at end, not select-all', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    // Add a seat — first select selects all text (verified by existing test).
    await toggleMode(page);                                  // → Add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();
    await expect(page.locator('#seat_name')).toBeFocused();

    // Type a name so the placeholder is replaced.
    await page.keyboard.type('FirstRename');

    // Click an existing seat to deselect the new one.
    const [existing] = await getZoneSeats(ZID);
    await selectSeat(page, existing);

    // Click back to the newly added seat. The seat was created at EMPTY_SPOT
    // (createNewSeat centers the sprite on the click point), so its div center
    // is at EMPTY_SPOT within the container.
    await page.locator('#zone_map_container').click({
      position: { x: EMPTY_SPOT.x, y: EMPTY_SPOT.y },
    });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();
    await expect(page.locator('#seat_name')).toBeFocused();

    // The name was changed from the placeholder, so the caret should be at the
    // end (not select-all). Typing appends; if text were selected it would replace.
    await page.keyboard.type('X');
    await expect(page.locator('#seat_name')).toHaveValue('FirstRenameX');
  });

  test('re-selecting an added seat with unchanged placeholder still selects all text', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    // Add a seat — placeholder name is auto-generated (NEW_x).
    await toggleMode(page);                                  // → Add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();

    // Do NOT type anything — leave the placeholder name as-is.
    // Click an existing seat to deselect the new one.
    const [existing] = await getZoneSeats(ZID);
    await selectSeat(page, existing);

    // Click back to the newly added seat.
    await page.locator('#zone_map_container').click({
      position: { x: EMPTY_SPOT.x, y: EMPTY_SPOT.y },
    });
    await expect(page.locator('#seat_edit_panel')).toBeVisible();
    await expect(page.locator('#seat_name')).toBeFocused();

    // The name is still the placeholder, so all text should be selected.
    // Typing replaces the placeholder entirely.
    await page.keyboard.type('Replaced');
    await expect(page.locator('#seat_name')).toHaveValue('Replaced');
  });

});

// ─── Combined changes and summary ─────────────────────────────────────────────

test.describe('combined changes and summary dialog', () => {

  test('summary correctly reports add + update + delete', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);

    // 1. Edit first seat name
    await selectSeat(page, seats[0]);
    await page.locator('#seat_name').fill('EditedSeat');

    // 2. Mark second seat for deletion
    await selectSeat(page, seats[1]);
    await page.locator('#seat_delete_btn').click();

    // 3. Add a new seat
    await toggleMode(page);
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).toContainText('added one seat');
    await expect(modal).toContainText('updated data of a seat');
    await expect(modal).toContainText('deleted a seat');
    await modal.locator('button', { hasText: /No/i }).click();
  });

  test('cancel discards all changes', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);
    await page.locator('#seat_name').fill('ShouldNotBeSaved');

    await page.locator('#cancelBtn').click();
    await expect(page).toHaveURL(/\/plans$/);

    const result = await querySql('SELECT name FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].name).toBe(seat.name);
  });

  test('direct API: add + update + delete in one multipart request', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);

    const resp = await page.request.post('/xhr/plans/modify', {
      multipart: {
        json: JSON.stringify({
          pid: ZID,
          addOrUpdate: [
            { name: 'APIAdded', x: 600, y: 500, zid: ZID }, // explicit zone; default_zid per plan was removed
            { sid: seats[2].id, name: 'APIUpdated', x: seats[2].x, y: seats[2].y },
          ],
          remove: [seats[3].id],
        }),
      },
    });
    expect(resp.status()).toBe(200);

    const added = await querySql("SELECT id FROM seat WHERE zid = $1 AND name = 'APIAdded'", [ZID]);
    expect(added.rows).toHaveLength(1);

    const updated = await querySql('SELECT name FROM seat WHERE id = $1', [seats[2].id]);
    expect(updated.rows[0].name).toBe('APIUpdated');

    const deleted = await querySql('SELECT COUNT(*)::int AS cnt FROM seat WHERE id = $1', [seats[3].id]);
    expect(deleted.rows[0].cnt).toBe(0);
  });

});

// ─── Marquee transform and rotation ───────────────────────────────────────────

const SPRITE = 48;
const ROTATE_GRIP = '.zone_modify_marquee_rotate';
const GUIDE_LINE = '.zone_modify_rotate_line';
const GUIDE_PIVOT = '.zone_modify_rotate_pivot';
const GUIDE_LABEL = '.zone_modify_rotate_label';

function seatBounds(seats: { x: number; y: number }[]) {
  const minX = Math.min(...seats.map((s) => s.x));
  const minY = Math.min(...seats.map((s) => s.y));
  const maxX = Math.max(...seats.map((s) => s.x + SPRITE));
  const maxY = Math.max(...seats.map((s) => s.y + SPRITE));
  return { minX, minY, maxX, maxY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

async function mapOrigin(page: import('@playwright/test').Page) {
  const box = await page.locator('#zone_map').boundingBox();
  expect(box).not.toBeNull();
  return box!;
}

async function gripCenter(page: import('@playwright/test').Page) {
  const box = await page.locator(ROTATE_GRIP).boundingBox();
  expect(box).not.toBeNull();
  return { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 };
}

test.describe('marquee transform and rotation', () => {

  test('edit mode shows marquee box, resize handles, and rotate grip', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    await expect(page.locator('.zone_modify_marquee_box')).toBeVisible();
    await expect(page.locator('.zone_modify_marquee_handle:visible')).toHaveCount(8);
    await expect(page.locator(ROTATE_GRIP)).toBeVisible();

    // Rotate guide is not shown outside of a rotate drag
    await expect(page.locator(GUIDE_LINE)).toBeHidden();
    await expect(page.locator(GUIDE_PIVOT)).toBeHidden();
    await expect(page.locator(GUIDE_LABEL)).toBeHidden();
  });

  test('dragging the marquee box moves all seats together', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);

    // Drag from a point on the marquee border (top edge, 25% across) — clear of
    // the nw/ne corner handles and the centred 'n' edge handle. Page coords
    // from the DOM box, so no map-origin offset is needed.
    const boxEl = page.locator('.zone_modify_marquee_box');
    const box = await boxEl.boundingBox();
    expect(box).not.toBeNull();
    const borderPoint = { x: box!.x + box!.width * 0.25, y: box!.y };

    await page.mouse.move(borderPoint.x, borderPoint.y);
    await page.mouse.down();
    await page.mouse.move(borderPoint.x + 20, borderPoint.y + 15, { steps: 5 });
    await page.mouse.up();

    await saveAndConfirm(page);

    const after = await getZoneSeats(ZID);
    for (const s of seats) {
      const a = after.find((t) => t.id === s.id)!;
      expect(Math.abs(a.x - (s.x + 20))).toBeLessThanOrEqual(1);
      expect(Math.abs(a.y - (s.y + 15))).toBeLessThanOrEqual(1);
    }
  });

  test('clicking inside the marquee interior keeps the selection and does not move seats', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);
    const map = await mapOrigin(page);

    // EMPTY_SPOT is inside the group bounds but not on any seat sprite — i.e. an
    // interior point of the marquee. After the border-grip change, clicking
    // here must NOT start a move and must NOT clear the selection.
    const spot = { x: map.x + EMPTY_SPOT.x, y: map.y + EMPTY_SPOT.y };
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    await page.mouse.move(spot.x + 20, spot.y + 15, { steps: 5 });
    await page.mouse.up();

    // The marquee (selection) must still be visible — interior clicks suppress
    // deselection, so the selection is preserved.
    await expect(page.locator('.zone_modify_marquee_box')).toBeVisible();

    // No save occurred (save button stays disabled — no changes made), so DB
    // coordinates must be unchanged.
    await expect(page.locator('#saveBtn')).toHaveClass(/disabled/);
    const after = await getZoneSeats(ZID);
    for (const s of seats) {
      const a = after.find((t) => t.id === s.id)!;
      expect(a.x).toBe(s.x);
      expect(a.y).toBe(s.y);
    }
  });

  test('rotate drag hides marquee and shows pivot, guide line, and angle readout', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    const grip = await gripCenter(page);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 80, grip.y + 60, { steps: 5 });

    // Selection chrome is hidden during the drag…
    await expect(page.locator('.zone_modify_marquee_box')).toBeHidden();
    await expect(page.locator('.zone_modify_marquee_handle:visible')).toHaveCount(0);
    await expect(page.locator(ROTATE_GRIP)).toBeHidden();

    // …replaced by the rotation guide
    await expect(page.locator(GUIDE_LINE)).toBeVisible();
    await expect(page.locator(GUIDE_PIVOT)).toBeVisible();
    await expect(page.locator(GUIDE_LABEL)).toBeVisible();
    await expect(page.locator(GUIDE_LABEL)).toHaveText(/^-?\d+°$/);

    await page.mouse.up();

    // Marquee returns, guide disappears
    await expect(page.locator('.zone_modify_marquee_box')).toBeVisible();
    await expect(page.locator(ROTATE_GRIP)).toBeVisible();
    await expect(page.locator(GUIDE_LINE)).toBeHidden();
    await expect(page.locator(GUIDE_PIVOT)).toBeHidden();
    await expect(page.locator(GUIDE_LABEL)).toBeHidden();
  });

  test('rotating 180° mirrors all seats through the group center', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    const b = seatBounds(seats);
    await openEditor(page);
    const map = await mapOrigin(page);

    // Drag the grip from above the group to the mirrored point below the
    // pivot (same x) — exactly a half turn, which preserves the bounding box
    // so no boundary clamping kicks in.
    const grip = await gripCenter(page);
    const endY = 2 * (map.y + b.cy) - grip.y;

    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x, endY, { steps: 10 });
    await expect(page.locator(GUIDE_LABEL)).toHaveText(/^-?(179|180|181)°$/);
    await page.mouse.up();

    await saveAndConfirm(page);

    const after = await getZoneSeats(ZID);
    for (const s of seats) {
      const a = after.find((t) => t.id === s.id)!;
      expect(Math.abs(a.x - (2 * b.cx - s.x - SPRITE))).toBeLessThanOrEqual(3);
      expect(Math.abs(a.y - (2 * b.cy - s.y - SPRITE))).toBeLessThanOrEqual(3);
    }
  });

  test('rotation pivots around the selected seat, which stays locked', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    // A seat near the middle of the group, so a small rotation keeps most
    // seats inside the map
    const pivotSeat = seats.find((s) => s.name === '3.1')!;
    await openEditor(page);
    const map = await mapOrigin(page);

    await selectSeat(page, pivotSeat);

    const grip = await gripCenter(page);
    await page.mouse.move(grip.x, grip.y);
    await page.mouse.down();
    await page.mouse.move(grip.x + 60, grip.y + 10, { steps: 5 });

    // The pivot marker sits on the selected seat's center
    const marker = await page.locator(GUIDE_PIVOT).boundingBox();
    expect(marker).not.toBeNull();
    const markerCx = marker!.x + marker!.width / 2 - map.x;
    const markerCy = marker!.y + marker!.height / 2 - map.y;
    expect(Math.abs(markerCx - (pivotSeat.x + SPRITE / 2))).toBeLessThanOrEqual(2);
    expect(Math.abs(markerCy - (pivotSeat.y + SPRITE / 2))).toBeLessThanOrEqual(2);

    await page.mouse.up();
    await saveAndConfirm(page);

    const after = await getZoneSeats(ZID);
    const pivotAfter = after.find((t) => t.id === pivotSeat.id)!;
    expect(pivotAfter.x).toBe(pivotSeat.x);
    expect(pivotAfter.y).toBe(pivotSeat.y);

    const someoneMoved = after.some((a) => {
      const s = seats.find((t) => t.id === a.id)!;
      return s.x !== a.x || s.y !== a.y;
    });
    expect(someoneMoved).toBe(true);
  });

});

// ─── Seat labels ────────────────────────────────────────────────────────────

test.describe('seat labels in the editor', () => {

  test('each seat shows a label with its name', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);

    const labels = page.locator('#zone_map_container > .seat_label');
    await expect(labels).toHaveCount(seats.length);
    // First seat's label title shows the seat name
    await expect(labels.first().locator('.seat_label_title')).toHaveText(seats[0].name);
  });

  test('renaming a seat updates the label live', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    await page.locator('#seat_name').fill('LiveUpdateName');
    // The label title should reflect the new name immediately
    const label = page.locator('#zone_map_container > .seat_label').first();
    await expect(label.locator('.seat_label_title')).toHaveText('LiveUpdateName');

    // Discard changes
    await page.locator('#cancelBtn').click();
    const modal = page.locator('.modal.open', { hasText: /unsaved changes/ });
    if (await modal.isVisible()) {
      await modal.locator('button', { hasText: /Yes/i }).click();
    }
  });

  test('newly placed seat shows a label with its NEW_ name', async ({ page }) => {
    await logIn(page, ADMIN);
    const beforeCount = (await getZoneSeats(ZID)).length;
    await openEditor(page);

    await toggleMode(page); // add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    const labels = page.locator('#zone_map_container > .seat_label');
    await expect(labels).toHaveCount(beforeCount + 1);
    // The newest label should contain the NEW_ prefix
    const allTexts = await labels.locator('.seat_label_title').allTextContents();
    const hasNew = allTexts.some((t) => t.startsWith('NEW_'));
    expect(hasNew).toBe(true);
  });

  test('deleted seat label is greyed out', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);

    // Before delete, label is not greyed
    const label = page.locator('#zone_map_container > .seat_label').first();
    await expect(label).not.toHaveClass(/seat_label_deleted/);

    await page.locator('#seat_delete_btn').click();
    await expect(label).toHaveClass(/seat_label_deleted/);

    // Restore un-greys the label
    await page.locator('#seat_delete_btn').click();
    await expect(label).not.toHaveClass(/seat_label_deleted/);
  });

  test('single-zone plan does not show zone line on labels', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    // Plan 1 has seats from only one zone → no .seat_label_zone elements
    const zoneLines = page.locator('#zone_map_container > .seat_label .seat_label_zone');
    await expect(zoneLines).toHaveCount(0);
  });

  test('moving a seat to a second zone toggles the zone line on all labels', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);

    const zoneLines = page.locator('#zone_map_container > .seat_label .seat_label_zone');

    // Plan 1 starts single-zone (all seats in zone 1 "Zone 1A") → no zone lines.
    await expect(zoneLines).toHaveCount(0);

    // Reassign one seat to zone 2 ("Zone 1B") via the side-panel dropdown. The plan
    // now spans two zones, so the zone line must appear on *every* label (the toggle
    // is plan-wide, not per-seat). Drive the native <select> directly: Materialize
    // overlays it, and the app only listens for the native 'change' event.
    await selectSeat(page, seats[0]);
    await page.$eval('#seat_zone', (el) => {
      const sel = el as HTMLSelectElement;
      sel.value = '2';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(zoneLines).toHaveCount(seats.length);
    await expect(zoneLines.filter({ hasText: 'Zone 1B' })).toHaveCount(1);
    await expect(zoneLines.filter({ hasText: 'Zone 1A' })).toHaveCount(seats.length - 1);

    // Revert to a single zone → all zone lines disappear again.
    await page.$eval('#seat_zone', (el) => {
      const sel = el as HTMLSelectElement;
      sel.value = '1';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(zoneLines).toHaveCount(0);

    // Discard unsaved changes.
    await page.locator('#cancelBtn').click();
    const modal = page.locator('.modal.open', { hasText: /unsaved changes/ });
    if (await modal.isVisible()) {
      await modal.locator('button', { hasText: /Yes/i }).click();
    }
  });

});

// ─── API error cases ──────────────────────────────────────────────────────────

test.describe('zone editor API error cases', () => {

  test('saveBtn starts disabled when no changes made', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);
    await expect(page.locator('#saveBtn')).toHaveClass(/disabled/);
  });

  test('non-admin cannot POST to /xhr/plans/modify (code 330)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.post('/xhr/plans/modify', {
      multipart: {
        json: JSON.stringify({ pid: ZID, addOrUpdate: [{ name: 'X', x: 0, y: 0 }] }),
      },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(330);
  });

  test('malformed JSON in modify returns 400', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.post('/xhr/plans/modify', {
      multipart: { json: '{bad json' },
    });
    expect([400, 404]).toContain(resp.status());
  });

});
