import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats } from '../../helpers/booking';
import { TAB, adminPost } from '../../helpers/admin';

test.describe('booking report', () => {

  test('admin can access the report page', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/bookings/report');
    await expect(page.locator('#reportTable')).toBeVisible();
  });

  test('non-admin is forbidden from the report page', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/bookings/report');
    expect(resp.status()).toBe(403);
  });

  test('report API includes all bookings (past and future)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    const tomorrow = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)',
      ['user1', seat.id, yesterday + 9 * 3600, yesterday + 17 * 3600,
       tomorrow + 9 * 3600, tomorrow + 17 * 3600],
    );

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/bookings/report', TAB);
    expect(resp.status()).toBe(200);
    expect((await resp.json()).data.length).toBe(2);
  });

  test('report includes login field (not present in regular bookings list)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/bookings/report', TAB);
    const data = (await resp.json()).data;
    expect(data[0]).toHaveProperty('login');
    expect(data[0].login).toBe('user1');
  });

  test('report API returns bookings from all zones', async ({ page }) => {
    const zone1Seats = await getZoneSeats(1);
    const zone2Seats = await getZoneSeats(2);
    const ts = futureDayTs(1);
    // Use different users: Zone 1 and Zone 2 share zone_group — same user same-time bookings conflict.
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', zone1Seats[0].id, ts + 9 * 3600, ts + 17 * 3600],
    );
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', zone2Seats[0].id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/bookings/report', TAB);
    const zoneNames = (await resp.json()).data.map((r: any) => r.zone_name);
    expect(zoneNames).toContain('Zone 1A');
    expect(zoneNames).toContain('Zone 1B');
  });

  test('non-admin cannot call the report API (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/bookings/report', TAB);
    expect(resp.status()).toBe(403);
  });

  test('report page shows Login column (not shown in regular bookings)', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/bookings/report');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-col[tabulator-field="login"]')).toBeVisible();
  });

  test('regular bookings page does NOT show Login column', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/bookings');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-col[tabulator-field="login"]')).toHaveCount(0);
  });

});
