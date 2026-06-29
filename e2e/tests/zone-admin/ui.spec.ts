/**
 * Zone admin UI: action modal visibility, seat enable/disable via the edit modal.
 *
 * user1 = zone admin (role 10) in Zone 1
 * user2 = regular zone user (role 20) in Zone 1
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  getZoneSeats,
  selectOnlyDates,
  clickZoneSeat,
  waitForSeatsLoaded,
} from '../../helpers/booking';
import { pickFirstDate, openSeatEditModal, setSeatEnabledAndSave } from '../../helpers/zone-admin';

// ─── Zone Admin UI Actions ────────────────────────────────────────────────────

test.describe('zone admin action modal', () => {

  test('zone admin sees the flat Edit button in the action modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    await expect(page.locator('.plan_action_btn[data-action="seat-edit"]')).toBeVisible();
    await expect(page.locator('.plan_action_btn[data-action="book"]')).toBeVisible();
    // The old separate Assign / Enable / Disable buttons are gone.
    await expect(page.locator('.plan_action_btn[data-action="assign-modal"]')).toHaveCount(0);
    await expect(page.locator('.plan_action_btn[data-action="enable"]')).toHaveCount(0);
    await expect(page.locator('.plan_action_btn[data-action="disable"]')).toHaveCount(0);
  });

  test('regular user does NOT see the Edit button', async ({ page }) => {
    await logIn(page, USER2);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    await expect(page.locator('.plan_action_btn[data-action="seat-edit"]')).not.toBeVisible();
  });

});

// ─── Disable / Enable Seats (via the edit modal toggle) ───────────────────────

test.describe('disable and enable seats', () => {

  test('zone admin can disable a seat via the edit modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await openSeatEditModal(page);

    // The toggle reflects the live enabled state (seat is enabled by default).
    await expect(page.locator('#seat_edit_enabled')).toBeChecked();
    await setSeatEnabledAndSave(page, false);

    const result = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].enabled).toBe(false);
  });

  test('disabled seat shows the toggle off in the edit modal', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await openSeatEditModal(page);
    await expect(page.locator('#seat_edit_enabled')).not.toBeChecked();
  });

  test('zone admin can re-enable a disabled seat', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await openSeatEditModal(page);
    await setSeatEnabledAndSave(page, true);

    const result = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].enabled).toBe(true);
  });

  test('disabled seat is absent from regular user zone API response', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/plan/getSeats/1');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(String(seat.id) in body.seats).toBe(false);
  });

  test('disabled seat IS present in zone admin API response', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/plan/getSeats/1');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(String(seat.id) in body.seats).toBe(true);
    expect(body.seats[String(seat.id)].enabled).toBe(false);
  });

  test('disabling a seat with active bookings still disables it (bookings not auto-removed)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await openSeatEditModal(page);
    await setSeatEnabledAndSave(page, false);

    const seatResult = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(seatResult.rows[0].enabled).toBe(false);

    const bookResult = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE sid = $1',
      [seat.id],
    );
    expect(bookResult.rows[0].cnt).toBe(1);
  });

});