/**
 * Zone editor tests: /zones/modify/{zid}
 *
 * Two modes toggled by #modeSwitch (Materialize switch):
 *   unchecked (default) = edit mode   — click seats to select, drag to move
 *   checked             = add mode    — click map image to place a new seat
 *
 * Clicking the lever element toggles the switch (force-checking the hidden
 * <input> doesn't fire the change event reliably).
 *
 * Translated summary strings (en.js smart_count pluralisation):
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
  await page.goto(`/zones/modify/${zid}?return=/zones`);
  await expect(page.locator('#zone_map')).toBeVisible();
  await expect(page.locator('#saveBtn')).toBeAttached();
  await page.waitForLoadState('networkidle');
}

/** Click a seat at its centre — works in both edit and add modes
 *  (in add mode only if modeSwitch is unchecked first). */
async function selectSeat(
  page: import('@playwright/test').Page,
  seat: { x: number; y: number },
): Promise<void> {
  await page.locator('#zone_map_container').click({
    position: { x: seat.x + 24, y: seat.y + 24 },
  });
  await expect(page.locator('#seat_edit_panel')).toBeVisible();
}

/** Toggle the mode switch (Edit↔Add Seats) by clicking the Materialize lever. */
async function toggleMode(page: import('@playwright/test').Page): Promise<void> {
  const lever = page.locator('label:has(#modeSwitch) .lever');
  await lever.scrollIntoViewIfNeeded();
  await lever.click();
}

async function saveAndConfirm(page: import('@playwright/test').Page): Promise<void> {
  await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);
  await page.locator('#saveBtn').click();
  const modal = page.locator('.modal.open', { hasText: /update the zone/ });
  await expect(modal).toBeVisible();
  await modal.locator('a', { hasText: /Yes/i }).click();
  await expect(page).toHaveURL(/\/zones$/);
}

// ─── Access ───────────────────────────────────────────────────────────────────

test.describe('zone editor access', () => {

  test('admin can access the zone editor', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);
    await expect(page.locator('#saveBtn')).toBeAttached();
    await expect(page.locator('#modeSwitch')).toBeAttached();
  });

  test('non-site-admin is forbidden from the zone editor', async ({ page }) => {
    await logIn(page, USER1); // zone admin but not site admin
    const resp = await page.request.get(`/zones/modify/${ZID}`);
    expect(resp.status()).toBe(403);
  });

  test('zone editor shows existing seats', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);
    await openEditor(page);
    const count = await page.locator('#zone_map_container > div[style*="background-image"]').count();
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
    const modal = page.locator('.modal.open', { hasText: /update the zone/ });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText('updated data of a seat');
    await modal.locator('a', { hasText: /No/i }).click();
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
    const modal = page.locator('.modal.open', { hasText: /update the zone/ });
    await expect(modal).toContainText('deleted a seat');
    await modal.locator('a', { hasText: /No/i }).click();
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
    const modal = page.locator('.modal.open', { hasText: /update the zone/ });
    await expect(modal).not.toContainText('deleted');
    await modal.locator('a', { hasText: /No/i }).click();
  });

});

// ─── Add seats ────────────────────────────────────────────────────────────────

test.describe('adding a seat', () => {

  test('toggling to add mode checks the mode switch', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);

    await expect(page.locator('#modeSwitch')).not.toBeChecked();
    await toggleMode(page); // → add mode
    await expect(page.locator('#modeSwitch')).toBeChecked();
    await toggleMode(page); // → back to edit mode
    await expect(page.locator('#modeSwitch')).not.toBeChecked();
  });

  test('clicking map in add mode creates a new seat div', async ({ page }) => {
    await logIn(page, ADMIN);
    const beforeCount = (await getZoneSeats(ZID)).length;
    await openEditor(page);

    await toggleMode(page); // add mode
    await page.locator('#zone_map').click({ position: EMPTY_SPOT });

    const count = await page.locator('#zone_map_container > div[style*="background-image"]').count();
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
    const modal = page.locator('.modal.open', { hasText: /update the zone/ });
    await expect(modal).toContainText('added one seat');
    await modal.locator('a', { hasText: /No/i }).click();
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
    const modal = page.locator('.modal.open', { hasText: /update the zone/ });
    await expect(modal).toContainText('added one seat');
    await expect(modal).toContainText('updated data of a seat');
    await expect(modal).toContainText('deleted a seat');
    await modal.locator('a', { hasText: /No/i }).click();
  });

  test('cancel discards all changes', async ({ page }) => {
    await logIn(page, ADMIN);
    const [seat] = await getZoneSeats(ZID);
    await openEditor(page);
    await selectSeat(page, seat);
    await page.locator('#seat_name').fill('ShouldNotBeSaved');

    await page.locator('#cancelBtn').click();
    await expect(page).toHaveURL(/\/zones$/);

    const result = await querySql('SELECT name FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].name).toBe(seat.name);
  });

  test('direct API: add + update + delete in one multipart request', async ({ page }) => {
    await logIn(page, ADMIN);
    const seats = await getZoneSeats(ZID);

    const resp = await page.request.post('/xhr/zones/modify', {
      multipart: {
        json: JSON.stringify({
          zid: ZID,
          addOrUpdate: [
            { name: 'APIAdded', x: 600, y: 500 },
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

// ─── API error cases ──────────────────────────────────────────────────────────

test.describe('zone editor API error cases', () => {

  test('saveBtn starts disabled when no changes made', async ({ page }) => {
    await logIn(page, ADMIN);
    await openEditor(page);
    await expect(page.locator('#saveBtn')).toHaveClass(/disabled/);
  });

  test('non-admin cannot POST to /xhr/zones/modify (code 230)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.post('/xhr/zones/modify', {
      multipart: {
        json: JSON.stringify({ zid: ZID, addOrUpdate: [{ name: 'X', x: 0, y: 0 }] }),
      },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(230);
  });

  test('malformed JSON in modify returns 400', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.post('/xhr/zones/modify', {
      multipart: { json: '{bad json' },
    });
    expect([400, 404]).toContain(resp.status());
  });

});
