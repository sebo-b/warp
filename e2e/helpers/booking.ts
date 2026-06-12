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
export async function getFirstZoneDate(page: Page, zid: number): Promise<number> {
  if (!page.url().includes(`/zone/${zid}`)) {
    await page.goto(`/zone/${zid}`);
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

/** Click the center of a seat sprite within #zonemap. Seats are 48×48 px. */
export async function clickZoneSeat(page: Page, seat: SeatRow): Promise<void> {
  await page.locator('#zonemap').click({
    position: { x: seat.x + 24, y: seat.y + 24 },
  });
}

/** Wait for the seat data XHR to complete (seats appear after the load). */
export async function waitForSeatsLoaded(page: Page): Promise<void> {
  await page.waitForLoadState('networkidle');
}

/**
 * Full UI booking flow: navigate to zone, select dates, click seat, confirm.
 * Waits for networkidle after confirmation (covers the reload XHR).
 */
export async function bookSeatUI(
  page: Page,
  zid: number,
  seat: SeatRow,
  timestamps: number[],
): Promise<void> {
  await page.goto(`/zone/${zid}`);
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
    page.waitForResponse(r => r.url().includes('/xhr/zone/apply') && r.status() === 200),
    page.locator('.zone_action_btn[data-action="book"]').click(),
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
    page.waitForResponse(r => r.url().includes('/xhr/zone/apply') && r.status() === 200),
    page.locator(`.zone_action_btn[data-action="${action}"]`).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

/** Direct XHR to /xhr/zone/apply using the current page session (cookies). */
export async function apiApply(
  page: Page,
  body: object,
): Promise<import('@playwright/test').APIResponse> {
  return page.request.post('/xhr/zone/apply', {
    data: body,
    headers: { 'Content-Type': 'application/json' },
  });
}
