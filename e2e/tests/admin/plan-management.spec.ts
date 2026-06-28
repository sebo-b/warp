/**
 * Plan management: CRUD for plans and the plan map editor.
 * Covers /plans, /plans/modify/<pid>, and all /xhr/plans/* endpoints.
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { TAB, adminPost } from '../../helpers/admin';

/** Set the WARP light/dark theme cookie before any navigation. */
async function setThemeCookie(page: any, theme: 'light' | 'dark') {
  const context = page.context();
  const url = page.url();
  const domain = url ? new URL(url).hostname : 'localhost';
  await context.addCookies([
    { name: 'warp_theme', value: theme, domain, path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }
  ]);
}

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

  test('plan list can be filtered by zone name', async ({ page }) => {
    await logIn(page, ADMIN);
    // Filter by 'Zone 1A' — should return plans that have seats in Zone 1A
    const resp = await adminPost(page, '/xhr/plans/list', {
      ...TAB,
      filter: [{ field: 'zone_names', type: '=', value: 'Zone 1A' }],
    });
    expect(resp.status()).toBe(200);
    const data = (await resp.json()).data;
    expect(data.length).toBeGreaterThan(0);
    // Every returned plan should have Zone 1A in its zone_names
    for (const plan of data) {
      expect(plan.zone_names).toContain('Zone 1A');
    }
  });

  test('admin can create a new plan', async ({ page }) => {
    await logIn(page, ADMIN);
    // timezone is required since per-plan TZ (PLAN §5); zone is per-seat now.
    const resp = await adminPost(page, '/xhr/plans/addoredit', { name: 'Test Plan', timezone: 'UTC' });
    expect(resp.status()).toBe(200);

    const result = await querySql("SELECT id FROM plan WHERE name = 'Test Plan'");
    expect(result.rowCount).toBe(1);
  });

  test('admin can edit a plan name', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/plans/addoredit', {
      id: 1, name: 'Renamed Plan', timezone: 'UTC',
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT name FROM plan WHERE id = 1');
    expect(result.rows[0].name).toBe('Renamed Plan');
  });

  test('addOrEdit rejects an invalid IANA timezone with code 323', async ({ page }) => {
    await logIn(page, ADMIN);
    // 'Fake/Zone' is not resolvable by zoneinfo → is_valid_iana returns False.
    const resp = await adminPost(page, '/xhr/plans/addoredit', {
      name: 'Bad TZ Plan', timezone: 'Fake/Zone',
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(323);
  });

  test('admin can set default_zid on a plan (no longer supported — zone is per-seat)', async ({ page }) => {
    await logIn(page, ADMIN);
    // default_zid column was removed; zone is now selected per-seat in the editor
    const resp = await adminPost(page, '/xhr/plans/addoredit', {
      id: 1, name: 'Plan 1A', timezone: 'UTC',
    });
    expect(resp.status()).toBe(200);
  });

  test('admin can delete a plan', async ({ page }) => {
    await logIn(page, ADMIN);
    const createResp = await adminPost(page, '/xhr/plans/addoredit', { name: 'TempPlan', timezone: 'UTC' });
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

  test('admin can list plan timezones, non-admin is forbidden', async ({ page }) => {
    await logIn(page, USER1);
    const denied = await page.request.get('/xhr/plans/timezones');
    expect(denied.status()).toBe(403);

    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/plans/timezones');
    expect(resp.status()).toBe(200);
    const list = await resp.json();
    expect(Array.isArray(list)).toBe(true);
    expect(list.length).toBeGreaterThan(0);
    // every entry carries an IANA id + a GMT label; UTC is always present.
    for (const z of list) {
      expect(typeof z.id).toBe('string');
      expect(z.id.length).toBeGreaterThan(0);
      expect(z.label).toContain('GMT');
    }
    expect(list.some((z: any) => z.id === 'UTC')).toBe(true);
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

  test('plan editor has three tabs', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans/modify/1');
    await page.waitForLoadState('networkidle');
    await expect(page.locator('#plan_modify_tabs')).toBeVisible();
    await expect(page.locator('#plan_modify_tabs a', { hasText: 'Transform' })).toBeVisible();
    await expect(page.locator('#plan_modify_tabs a', { hasText: 'Add mode' })).toBeVisible();
    await expect(page.locator('#plan_modify_tabs a', { hasText: 'Map edit' })).toBeVisible();
  });

  test('plan editor loads dark filter preset dropdown with Smart default', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans/modify/1');
    await page.waitForLoadState('networkidle');
    // The raw <select> is hidden by Materialize's FormSelect wrapper, so assert its
    // value rather than its visibility. The default plan filter is the "smart" preset
    // (set asynchronously once map_filter_presets.json loads — toHaveValue retries).
    const presetSelect = page.locator('#map_filter_preset');
    await expect(presetSelect).toHaveValue('smart');
  });

  test('plan editor persists a dark filter change', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans/modify/1');
    await page.waitForLoadState('networkidle');

    // The filter sliders live in the Map edit tab — activate it first.
    await page.locator('#plan_modify_tabs a', { hasText: 'Map edit' }).click();
    const invert = page.locator('#filter_invert');
    await expect(invert).toBeVisible();

    // Change invert from 0 to 50 (switching the preset to Custom). This also
    // dirties the form, enabling Save.
    await invert.fill('50');

    // Save & confirm. The confirm dialog lists the pending changes; its buttons are
    // <a> links inside the open WarpModal (same chrome the zone editor uses).
    await expect(page.locator('#saveBtn')).not.toHaveClass(/disabled/);
    await page.locator('#saveBtn').click();
    const modal = page.locator('.modal.open', { hasText: /update the plan/ });
    await expect(modal).toBeVisible();
    const modifyResp = page.waitForResponse(r => r.url().includes('/xhr/plans/modify') && r.request().method() === 'POST');
    await modal.locator('a', { hasText: /Yes/i }).click();
    await modifyResp;
    await expect(page).toHaveURL(/\/plans$/);

    const result = await querySql('SELECT dark_filter FROM plan WHERE id = 1');
    const stored = result.rows[0].dark_filter;
    expect(stored.id).toBe('custom');
    expect(stored.invert).toBe(50);
  });

  test('plan editor can cancel without dirty confirmation when unchanged', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/plans/modify/1');
    await page.waitForLoadState('networkidle');

    await page.locator('#cancelBtn').click();
    await page.waitForURL('/plans');
  });

  test('plan view applies dark filter to map image in dark mode', async ({ page }) => {
    await logIn(page, USER1);

    // Set the dark theme before loading the plan view
    await setThemeCookie(page, 'dark');

    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');

    const mapImg = page.locator('#planmap .OMBackground');
    const filter = await mapImg.evaluate((el: HTMLElement) => (el as HTMLImageElement).style.filter);
    expect(filter).toContain('invert');
  });

});
