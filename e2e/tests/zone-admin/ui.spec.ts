/**
 * Zone admin UI: action modal visibility, disable/enable seats.
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
  clickActionBtn,
} from '../../helpers/booking';
import { pickFirstDate } from '../../helpers/zone-admin';

// ─── Zone Admin UI Actions ────────────────────────────────────────────────────

test.describe('zone admin action modal', () => {

  test('zone admin sees Assign and Disable buttons in the action modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    await expect(page.locator('.zone_action_btn[data-action="assign-modal"]')).toBeVisible();
    await expect(page.locator('.zone_action_btn[data-action="disable"]')).toBeVisible();
    await expect(page.locator('.zone_action_btn[data-action="book"]')).toBeVisible();
  });

  test('regular user does NOT see Assign or Disable buttons', async ({ page }) => {
    await logIn(page, USER2);
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);

    await expect(page.locator('.zone_action_btn[data-action="assign-modal"]')).not.toBeVisible();
    await expect(page.locator('.zone_action_btn[data-action="disable"]')).not.toBeVisible();
  });

});

// ─── Disable / Enable Seats ───────────────────────────────────────────────────

test.describe('disable and enable seats', () => {

  test('zone admin can disable a seat via the action modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'disable');

    const result = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].enabled).toBe(false);
  });

  test('disabled seat shows Enable button when zone admin clicks it', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await expect(page.locator('.zone_action_btn[data-action="enable"]')).toBeVisible();
    await expect(page.locator('.zone_action_btn[data-action="disable"]')).not.toBeVisible();
  });

  test('zone admin can re-enable a disabled seat', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'enable');

    const result = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(result.rows[0].enabled).toBe(true);
  });

  test('disabled seat is absent from regular user zone API response', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(String(seat.id) in body.seats).toBe(false);
  });

  test('disabled seat IS present in zone admin API response', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/zone/getSeats/1');
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
    await page.goto('/zone/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await clickActionBtn(page, 'disable');

    const seatResult = await querySql('SELECT enabled FROM seat WHERE id = $1', [seat.id]);
    expect(seatResult.rows[0].enabled).toBe(false);

    const bookResult = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE sid = $1',
      [seat.id],
    );
    expect(bookResult.rows[0].cnt).toBe(1);
  });

});
