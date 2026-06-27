import { Page, expect } from '@playwright/test';
import { querySql } from './db';

export interface SeatRow {
  id: number;
  name: string;
  x: number;
  y: number;
}

/** Midnight UTC (seconds) for N days from today. Defaults to tomorrow (1). */
export function futureDayTs(daysFromNow = 1): number {
  const now = new Date();
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return todayMidnight / 1000 + daysFromNow * 86400;
}

/** Fetch all seats for a zone from the DB, ordered by id. */
export async function getZoneSeats(zid: number): Promise<SeatRow[]> {
  const result = await querySql(
    'SELECT id, name, x, y FROM seat WHERE zid = $1 ORDER BY id',
    [zid],
  );
  return result.rows.map((r: any) => ({
    id: Number(r.id),
    name: String(r.name),
    x: Number(r.x),
    y: Number(r.y),
  }));
}

/**
 * Navigate to the zone page and return the value of the first date checkbox
 * (as a seconds timestamp). Used to pick a date that the server actually renders.
 */
export async function getFirstZoneDate(page: Page, pid: number): Promise<number> {
  if (!page.url().includes(`/plan/${pid}`)) {
    await page.goto(`/plan/${pid}`);
    await page.waitForLoadState('networkidle');
  }
  const val = await page.locator('.date_checkbox').first().inputValue();
  return Number(val);
}

/**
 * Set checkbox state so only the given timestamps are checked.
 * Uses force:true because Materialize hides the native checkbox input.
 */
export async function selectOnlyDates(page: Page, timestamps: number[]): Promise<void> {
  const checkboxes = page.locator('.date_checkbox');
  const count = await checkboxes.count();
  for (let i = 0; i < count; i++) {
    const cb = checkboxes.nth(i);
    const val = Number(await cb.inputValue());
    if (timestamps.includes(val)) {
      await cb.check({ force: true });
    } else {
      await cb.uncheck({ force: true });
    }
  }
}

/**
 * Zoom the OfficeMap out to its minimum (fit) so the WHOLE map is inside
 * #planmap and every seat is on-screen and clickable. The booking view now opens
 * at a 1:1, centred default, which leaves seats near the map edges geometrically
 * outside #planmap (clipped, and on the left overlapped by the sidepanel) — there
 * a center-click lands on the sidepanel, not the seat. One big wheel-out clamps to
 * the fit scale and brings every seat into view. Idempotent (a no-op once at fit).
 */
export async function fitMap(page: Page): Promise<void> {
  const box = await page.locator('#planmap').boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 2400);   // large zoom-out → clamps at minScale (fit)
  await page.waitForTimeout(50);     // let the panzoomchange settle
}

/** Click a seat by its stable OfficeMap id (#sprite-<sid>). Fits the map first so
 *  the seat is on-screen regardless of the 1:1 default view. */
export async function clickZoneSeat(page: Page, seat: SeatRow): Promise<void> {
  await fitMap(page);
  await page.locator(`#sprite-${seat.id}`).click();
}

/** Wait for the seat data XHR to complete and at least one seat to render, then
 *  fit the map so seats are interactable (click/hover) from the default view. */
export async function waitForSeatsLoaded(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
  await page.locator('.OMSeat').first().waitFor({ state: 'visible' });
  await fitMap(page);
}

/**
 * Full UI booking flow: navigate to zone, select dates, click seat, confirm.
 * Waits for networkidle after confirmation (covers the reload XHR).
 */
export async function bookSeatUI(
  page: Page,
  pid: number,
  seat: SeatRow,
  timestamps: number[],
): Promise<void> {
  await page.goto(`/plan/${pid}`);
  await waitForSeatsLoaded(page);
  await selectOnlyDates(page, timestamps);
  // Brief settle so seat states recalculate after checkbox change
  await page.waitForTimeout(400);
  await clickZoneSeat(page, seat);
  await expect(page.locator('#action_modal')).toHaveClass(/open/);
  // Wait for the apply POST response (booking committed server-side) then for the
  // seat-refresh GET that fires in the .then() callback, and a brief pause for
  // Flask's request teardown to close the DB connection (commit becomes visible).
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
    page.locator('.plan_action_btn[data-action="book"]').click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

/**
 * Click a zone action button (book/delete/update/enable/disable), wait for the
 * apply response and Flask teardown to commit the transaction.
 */
export async function clickActionBtn(
  page: Page,
  action: 'book' | 'delete' | 'update' | 'enable' | 'disable',
): Promise<void> {
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
    page.locator(`.plan_action_btn[data-action="${action}"]`).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

/** Direct XHR to /xhr/plan/apply using the current page session (cookies).
 *  Redirects are not followed: an expired session answers with a 302 to /login,
 *  and following it would turn that into a misleading 200 (the login page). */
export async function apiApply(
  page: Page,
  body: object,
): Promise<import('@playwright/test').APIResponse> {
  return page.request.post('/xhr/plan/apply', {
    data: body,
    headers: { 'Content-Type': 'application/json' },
    maxRedirects: 0,
  });
}
