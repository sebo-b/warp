/**
 * Zone assignment (access rights) and zone modes (zone_type).
 */
import { test, expect } from '../../fixtures';
import { logIn, logOut } from '../../helpers/auth';
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats, apiApply } from '../../helpers/booking';
import { TAB, adminPost } from '../../helpers/admin';

test.describe('zone assignment', () => {

  test('admin can list zone members', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/members', { ...TAB, zid: 1 });
    expect(resp.status()).toBe(200);
    const logins = (await resp.json()).data.map((m: any) => m.login);
    expect(logins).toContain('user1');
    expect(logins).toContain('group_1a');
  });

  test('admin can assign a user to a zone with user role', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 1, change: [{ login: 'user3', role: 20 }],
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT zone_role FROM zone_assign WHERE zid = 1 AND login = $1', ['user3']);
    expect(Number(result.rows[0].zone_role)).toBe(20);
  });

  test('newly assigned user can access the zone', async ({ page }) => {
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (1, $1, 20)', ['user3']);

    await logIn(page, USER3);
    const resp = await page.request.get('/zone/1');
    expect(resp.status()).toBe(200);
  });

  test('admin can assign a user as zone admin (role 10)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 1, change: [{ login: 'user3', role: 10 }],
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT zone_role FROM zone_assign WHERE zid = 1 AND login = $1', ['user3']);
    expect(Number(result.rows[0].zone_role)).toBe(10);
  });

  test('zone admin can see admin buttons (Assign, Disable) on the zone map', async ({ page }) => {
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (1, $1, 10)', ['user3']);

    await logIn(page, USER3);
    await page.goto('/zone/1');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.zone_action_btn[data-action="assign-modal"]')).toBeAttached();
  });

  test('admin can assign viewer role (30) to a user', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 1, change: [{ login: 'user3', role: 30 }],
    });
    expect(resp.status()).toBe(200);
  });

  test('viewer-role user can access the zone but the FAB is hidden', async ({ page }) => {
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (1, $1, 30)', ['user3']);

    await logIn(page, USER3);
    await page.goto('/zone/1');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#zonemap')).toBeVisible();
    await expect(page.locator('#auto_book_btn')).toHaveCount(0);
    await expect(page.locator('#action_modal')).toHaveCount(0);
  });

  test('viewer-role user cannot book via API (code 104)', async ({ page }) => {
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (1, $1, 30)', ['user3']);

    await logIn(page, USER3);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('admin can change a zone role (upgrade user to admin)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 1, change: [{ login: 'user2', role: 10 }],
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT zone_role FROM zone_assign WHERE zid = 1 AND login = $1', ['user2']);
    expect(Number(result.rows[0].zone_role)).toBe(10);
  });

  test('admin can remove a user from a zone', async ({ page }) => {
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (1, $1, 20)', ['user3']);

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/assign', { zid: 1, remove: ['user3'] });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM zone_assign WHERE zid = 1 AND login = $1', ['user3']);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('non-admin cannot call zones/assign (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/zones/assign', {
      zid: 1, change: [{ login: 'user3', role: 20 }],
    });
    expect(resp.status()).toBe(403);
  });

});

test.describe('zone modes (zone_type)', () => {

  test('DISABLED zone blocks all non-admin users including assigned ones', async ({ page }) => {
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/addoredit', { id: 1, name: 'Zone 1A', zone_group: null, zone_type: 10 });

    await logOut(page);
    await logIn(page, USER2);
    const zoneResp = await page.request.get('/zone/1');
    expect(zoneResp.status()).toBe(403);
  });

  test('DISABLED zone still accessible to zone admin', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 10 WHERE id = 1');

    await logIn(page, USER1);
    const resp = await page.request.get('/zone/1');
    expect(resp.status()).toBe(200);
  });

  test('zone admin can still book in a DISABLED zone (effectiveRole=10 passes user check)', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 10 WHERE id = 1');

    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('regular user cannot book in a DISABLED zone (code 104)', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 10 WHERE id = 1');

    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('PUBLIC_VIEW zone accessible to users with no explicit assignment', async ({ page }) => {
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/addoredit', { id: 3, name: 'Parking', zone_group: 'Parking', zone_type: 30 });

    await logOut(page);
    await logIn(page, USER3);
    const zoneResp = await page.request.get('/zone/3');
    expect(zoneResp.status()).toBe(200);
  });

  test('PUBLIC_VIEW zone cannot be booked by unauthenticated (viewer-only) user', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 30 WHERE id = 3');

    await logIn(page, USER3);
    const zone3Seats = await getZoneSeats(3);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: zone3Seats[0].id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(104);
  });

  test('PUBLIC_VIEW user with explicit USER role can book', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 30 WHERE id = 3');
    await querySql('INSERT INTO zone_assign (zid, login, zone_role) VALUES (3, $1, 20)', ['user3']);

    await logIn(page, USER3);
    const zone3Seats = await getZoneSeats(3);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: zone3Seats[0].id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);
  });

  test('PUBLIC_BOOK zone lets any user book without explicit assignment', async ({ page }) => {
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/addoredit', { id: 3, name: 'Parking', zone_group: 'Parking', zone_type: 40 });

    await logOut(page);
    await logIn(page, USER3);
    const zone3Seats = await getZoneSeats(3);
    const ts = futureDayTs(1);
    const bookResp = await apiApply(page, {
      book: { sid: zone3Seats[0].id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(bookResp.status()).toBe(200);
  });

  test('PUBLIC_BOOK zone is accessible to every authenticated user', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 40 WHERE id = 3');

    await logIn(page, USER3);
    const resp = await page.request.get('/zone/3');
    expect(resp.status()).toBe(200);
  });

  test('re-enabling DISABLED zone restores access for assigned users', async ({ page }) => {
    await querySql('UPDATE zone SET zone_type = 10 WHERE id = 1');

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/zones/addoredit', { id: 1, name: 'Zone 1A', zone_group: null, zone_type: 20 });
    await logOut(page);

    await logIn(page, USER2);
    const resp = await page.request.get('/zone/1');
    expect(resp.status()).toBe(200);
  });

});
