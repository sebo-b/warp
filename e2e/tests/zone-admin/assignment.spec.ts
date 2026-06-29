/**
 * Zone admin seat assignment: API-level and modal UI.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  getZoneSeats,
  clickZoneSeat,
  waitForSeatsLoaded,
  apiApply,
} from '../../helpers/booking';
import { pickFirstDate } from '../../helpers/zone-admin';

// ─── Seat Assignment via API ──────────────────────────────────────────────────

test.describe('seat assignment via API', () => {

  test('zone admin can assign a seat to a specific user', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: { sid: seat.id, logins: [{ login: 'user2', days_in_advance: null }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT login, days_in_advance FROM seat_assign WHERE sid = $1',
      [seat.id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].login).toBe('user2');
    expect(result.rows[0].days_in_advance).toBeNull();
  });

  test('zone admin can assign a seat with a days_in_advance limit', async ({ page }) => {
    await logIn(page, USER1);
    const seats = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: { sid: seats[1].id, logins: [{ login: 'user2', days_in_advance: 3 }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT days_in_advance FROM seat_assign WHERE sid = $1 AND login = $2',
      [seats[1].id, 'user2'],
    );
    expect(Number(result.rows[0].days_in_advance)).toBe(3);
  });

  test('zone admin can assign a seat to everyone (null login)', async ({ page }) => {
    await logIn(page, USER1);
    const seats = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: { sid: seats[2].id, logins: [{ login: null, days_in_advance: 7 }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT login, days_in_advance FROM seat_assign WHERE sid = $1',
      [seats[2].id],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].login).toBeNull();
    expect(Number(result.rows[0].days_in_advance)).toBe(7);
  });

  test('zone admin can assign to multiple users at once', async ({ page }) => {
    await logIn(page, USER1);
    const seats = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: {
        sid: seats[3].id,
        logins: [
          { login: 'user1', days_in_advance: null },
          { login: 'user2', days_in_advance: 5 },
        ],
      },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT login FROM seat_assign WHERE sid = $1 ORDER BY login',
      [seats[3].id],
    );
    expect(result.rows.map((r: any) => r.login)).toEqual(['user1', 'user2']);
  });

  test('zone admin can clear all seat assignments (empty logins)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user2'],
    );

    await logIn(page, USER1);
    const resp = await apiApply(page, { assign: { sid: seat.id, logins: [] } });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM seat_assign WHERE sid = $1',
      [seat.id],
    );
    expect(result.rows[0].cnt).toBe(0);
  });

  test('assigning replaces previous assignment entirely', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );

    await logIn(page, USER1);
    const resp = await apiApply(page, {
      assign: { sid: seat.id, logins: [{ login: 'user2', days_in_advance: null }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT login FROM seat_assign WHERE sid = $1', [seat.id]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].login).toBe('user2');
  });

  test('assigning two everyone rows is rejected (code 111)', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: {
        sid: seat.id,
        logins: [
          { login: null, days_in_advance: null },
          { login: null, days_in_advance: 3 },
        ],
      },
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(111);
  });

  test('assigned seat shows in zone API response assignment list', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user2'],
    );

    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/plan/getSeats/1');
    const body = await resp.json();
    const seatData = body.seats[String(seat.id)];
    expect(seatData.assignments).toBeDefined();
    expect(seatData.assignments.map((a: any) => a.login)).toContain('user2');
  });

});

// ─── Edit Seat Modal UI ───────────────────────────────────────────────────────

test.describe('edit seat modal UI', () => {

  test('zone admin can open the edit modal from the action modal', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await page.locator('.plan_action_btn[data-action="seat-edit"]').click();

    await expect(page.locator('#seat_edit_modal')).toHaveClass(/open/);
    await expect(page.locator('#assigned_seat_add_input')).toBeVisible();
    await expect(page.locator('#seat_edit_modal .switch')).toBeVisible();
  });

  test('zone admin can assign a user to a seat through the edit modal UI', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await page.locator('.plan_action_btn[data-action="seat-edit"]').click();
    await expect(page.locator('#seat_edit_modal')).toHaveClass(/open/);

    const addInput = page.locator('#assigned_seat_add_input');
    await addInput.click();
    await addInput.pressSequentially('Bar', { delay: 50 });
    // 2.x renders every autocomplete's dropdown items on init (not only when
    // typed into), and the dropdown is moved to document.body, so a bare
    // `ul.autocomplete-content li` also matches the BookAs dropdown on this
    // page. Scope to this input's own dropdown via its data-target id.
    const dropdownId = await addInput.getAttribute('data-target');
    const dropdownItem = page.locator(`ul#${dropdownId} li`, { hasText: 'Bar [user2]' });
    await expect(dropdownItem).toBeVisible({ timeout: 5000 });
    await dropdownItem.click();

    await expect(page.locator('#assigned_seat_list .collection-item')).toContainText('Bar');

    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
      page.locator('#seat_edit_modal .plan_action_btn[data-action="seat-edit-save"]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const result = await querySql('SELECT login FROM seat_assign WHERE sid = $1', [seat.id]);
    expect(result.rows.map((r: any) => r.login)).toContain('user2');
  });

});
