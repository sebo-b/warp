import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { TAB, adminPost } from '../../helpers/admin';

test.describe('zone management', () => {

  test('admin can list all zones', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/list', TAB);
    expect(resp.status()).toBe(200);
    const names = (await resp.json()).data.map((z: any) => z.name);
    expect(names).toContain('Zone 1A');
    expect(names).toContain('Zone 1B');
    expect(names).toContain('Parking');
  });

  test('zone list includes admin/user/viewer counts per zone', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/list', TAB);
    const zone1 = (await resp.json()).data.find((z: any) => z.id === 1);
    expect(zone1).toBeDefined();
    expect(Number(zone1.admins)).toBeGreaterThan(0);
  });

  test('admin can create a new zone (default DISABLED)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/addoredit', { name: 'New Zone' });
    expect(resp.status()).toBe(200);

    const result = await querySql("SELECT zone_type FROM zone WHERE name = 'New Zone'");
    expect(Number(result.rows[0].zone_type)).toBe(10);
  });

  test('admin can create a zone with explicit type', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/addoredit', {
      name: 'Public Zone', zone_type: 40,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql("SELECT zone_type FROM zone WHERE name = 'Public Zone'");
    expect(Number(result.rows[0].zone_type)).toBe(40);
  });

  test('admin can rename a zone', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/addoredit', {
      id: 1, name: 'Zone Alpha', zone_type: 20,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT name FROM zone WHERE id = 1');
    expect(result.rows[0].name).toBe('Zone Alpha');
  });

  test('admin can change zone type via addoredit', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/addoredit', {
      id: 1, name: 'Zone 1A', zone_type: 30,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT zone_type FROM zone WHERE id = 1');
    expect(Number(result.rows[0].zone_type)).toBe(30);
  });

  test('admin can delete a zone', async ({ page }) => {
    await querySql("INSERT INTO zone (name, zone_type) VALUES ('Temp', 10)");
    const idResult = await querySql("SELECT id FROM zone WHERE name = 'Temp'");
    const zid = Number(idResult.rows[0].id);

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/zones/delete', { id: zid });
    expect(resp.status()).toBe(200);

    const countResult = await querySql('SELECT COUNT(*)::int AS cnt FROM zone WHERE id = $1', [zid]);
    expect(countResult.rows[0].cnt).toBe(0);
  });

  test('non-admin cannot list zones (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/zones/list', TAB);
    expect(resp.status()).toBe(403);
  });

  test('non-admin cannot create/edit zones (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/zones/addoredit', {
      id: 1, name: 'Hacked', zone_group: null, zone_type: 40,
    });
    expect(resp.status()).toBe(403);
  });

  test('non-admin cannot delete zones (403)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await adminPost(page, '/xhr/zones/delete', { id: 1 });
    expect(resp.status()).toBe(403);
  });

  test('admin zones page renders the Tabulator table with zone rows', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/zones');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(page.locator('.tabulator-row', { hasText: 'Parking' }).first()).toBeVisible();
  });

});
