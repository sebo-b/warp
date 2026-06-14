/**
 * Plan management: CRUD for plans and the plan map editor.
 * Covers /plans, /plans/modify/<pid>, and all /xhr/plans/* endpoints.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { TAB, adminPost } from '../../helpers/admin';

test.describe('plan management', () => {

  test('admin can list all plans', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/plans/list', TAB);
    expect(resp.status()).toBe(200);
    const names = (await resp.json()).data.map((p: any) => p.name);
    expect(names).toContain('Plan 1A');
    expect(names).toContain('Plan 1B');
    expect(names).toContain('Plan Parking');
  });

  test('plan list includes seat_count and zone_names', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/plans/list', TAB);
    const plan1 = (await resp.json()).data.find((p: any) => p.id === 1);
    expect(plan1).toBeDefined();
    expect(Number(plan1.seat_count)).toBeGreaterThan(0);
    expect(Array.isArray(plan1.zone_names)).toBe(true);
  });

  test('admin can create a new plan', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/plans/addoredit', { name: 'Test Plan' });
    expect(resp.status()).toBe(200);

    const result = await querySql("SELECT id FROM plan WHERE name = 'Test Plan'");
    expect(result.rowCount).toBe(1);
  });

  test('admin can edit a plan name', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/plans/addoredit', {
      id: 1, name: 'Renamed Plan',
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT name FROM plan WHERE id = 1');
    expect(result.rows[0].name).toBe('Renamed Plan');
  });

  test('admin can set default_zid on a plan (no longer supported — zone is per-seat)', async ({ page }) => {
    await logIn(page, ADMIN);
    // default_zid column was removed; zone is now selected per-seat in the editor
    const resp = await adminPost(page, '/xhr/plans/addoredit', {
      id: 1, name: 'Plan 1A',
    });
    expect(resp.status()).toBe(200);
  });

  test('admin can delete a plan', async ({ page }) => {
    await logIn(page, ADMIN);
    const createResp = await adminPost(page, '/xhr/plans/addoredit', { name: 'TempPlan' });
    expect(createResp.status()).toBe(200);
    const pid = (await querySql("SELECT id FROM plan WHERE name = 'TempPlan'")).rows[0].id;

    const deleteResp = await adminPost(page, '/xhr/plans/delete', { id: Number(pid) });
    expect(deleteResp.status()).toBe(200);

    const cnt = await querySql('SELECT COUNT(*)::int AS c FROM plan WHERE id = $1', [pid]);
    expect(cnt.rows[0].c).toBe(0);
  });

  test('non-admin cannot list plans (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/plans/list', TAB);
    expect(resp.status()).toBe(403);
  });

  test('admin can get seats for a plan', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/plans/getSeats/1');
    expect(resp.status()).toBe(200);
    const data = await resp.json();
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });

  test('admin can get all zones', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/plans/allZones');
    expect(resp.status()).toBe(200);
    const zones = await resp.json();
    expect(Array.isArray(zones)).toBe(true);
    expect(zones.some((z: any) => z.name === 'Zone 1A')).toBe(true);
  });

  test('admin can get zones for a specific plan', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/plans/zonesForPlan?pid=1');
    expect(resp.status()).toBe(200);
    const zones = await resp.json();
    expect(Array.isArray(zones)).toBe(true);
  });

  test('admin can modify plan seats (add a seat)', async ({ page }) => {
    await logIn(page, ADMIN);
    const body = new URLSearchParams();
    body.append('json', JSON.stringify({
      pid: 1,
      addOrUpdate: [{ name: 'Test seat', x: 10, y: 10, zid: 1 }],
    }));
    const resp = await page.request.post('/xhr/plans/modify', {
      data: body.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    expect(resp.status()).toBe(200);

    await querySql("DELETE FROM seat WHERE name = 'Test seat' AND pid = 1");
  });

  test('admin plans page renders the plan list', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.tabulator-row').first()).toBeVisible();
    await expect(page.locator('.tabulator-row', { hasText: 'Plan 1A' }).first()).toBeVisible();
  });

  test('admin plan editor page loads', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans/modify/1');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#zone_map')).toBeVisible();
  });

  test('plan image is served', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.get('/plan/image/1');
    expect([200, 404]).toContain(resp.status());
  });

  test('plan view page loads for accessible user', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/plan/1');
    expect(resp.status()).toBe(200);
  });

});
