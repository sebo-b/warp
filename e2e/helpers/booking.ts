import { Page, expect } from '@playwright/test';
import { querySql } from './db';

export interface SeatRow {
  id: number;
  name: string;
  x: number;
  y: number;
}

/** Calendar grid cell (matches warp.utils.getCalendarGrid's cell shape). */
export interface CalCell {
  timestamp: number | null;   // null for week/month padding fillers
  day: number | null;         // 1..31 for real, null for padding
  selectable: boolean;        // in [START,END] AND weekday not in OMITTED_WEEKDAYS
  isToday: boolean;
}
export interface CalendarMonth {
  year: number;
  monthIndex: number;   // 0..11
  weeks: CalCell[][];   // each week is exactly 7 cells
}
export interface CalendarGrid {
  weekdayHeader: number[];   // 7 indices 0=Sun..6=Sat, pre-rotated by WEEK_START_DAY
  months: CalendarMonth[];
  defaultTs: number | null;
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

/** The backend calendar-grid blob exposed to the plan page (PLAN §4.1).
 *  Pure data: weekdayHeader + months[{year,monthIndex,weeks}] + defaultTs.
 *  Drives the DOM; the source of truth for cell structure. */
export async function getCalendarGrid(page: Page): Promise<CalendarGrid> {
  return page.evaluate(() => (window as any).warpGlobals.calendarGrid);
}

/** Backend-driven selectable calendar cell timestamps, ASC by DOM order. The
 *  calendar renders cells in date order, so this reads them as the user sees them. */
export async function getSelectableDates(page: Page): Promise<number[]> {
  // Selectable cells: real (data-ts present), not disabled, not padded.
  const cells = page.locator('.warp-cal-day[data-ts]:not(.is-disabled)');
  const count = await cells.count();
  const out: number[] = [];
  for (let i = 0; i < count; i++)
    out.push(Number(await cells.nth(i).getAttribute('data-ts')));
  return out;
}

/** Real (non-padding) cells in DOM order — includes selectable AND greyed
 *  (past/omitted/post-window). Useful for asserting month-boundary splits. */
export async function getAllDayCells(page: Page) {
  return page.evaluate(() => {
    const els = Array.from(document.querySelectorAll('.warp-cal-day[data-ts]'));
    return els.map(el => ({
      ts: Number((el as HTMLElement).dataset.ts),
      selected: el.classList.contains('is-selected'),
      disabled: el.classList.contains('is-disabled'),
      today: el.classList.contains('is-today'),
    }));
  });
}

/** Navigate to the zone page and return the first selectable day's timestamp
 *  (today, the earliest rendered selectable cell). */
export async function getFirstZoneDate(page: Page, pid: number): Promise<number> {
  if (!page.url().includes(`/plan/${pid}`)) {
    await page.goto(`/plan/${pid}`);
    await page.waitForLoadState('networkidle');
  }
  const ts = await page.locator('.warp-cal-day[data-ts]:not(.is-disabled)').first().getAttribute('data-ts');
  if (ts === null) throw new Error('no selectable calendar cell found');
  return Number(ts);
}

/** Click any remaining selected days to deselect them (a plain click toggles).
 *  No clear-link in the UI anymore (YAGNI), so deselect is by toggling. */
async function clearSelection(page: Page): Promise<void> {
  const selected = page.locator('.warp-cal-day.is-selected');
  while (await selected.count()) {
    await selected.first().click();   // toggle off
  }
}

/**
 * Set the calendar so ONLY the given timestamps are selected. Selection model:
 *   click       -> toggle (select if absent, deselect if present)
 *   shift+click -> ADD the anchor->clicked range (union, keeps other selections)
 * So this clears first (toggles off anything selected), then for a contiguous
 * run clicks the start and shift-clicks the end to fill it; otherwise clicks
 * each requested day. Keeps the signature (timestamps in/out, same apply
 * payload) stable so the rest of the suite is untouched.
 */
export async function selectOnlyDates(page: Page, timestamps: number[]): Promise<void> {
  await clearSelection(page);
  if (!timestamps.length) return;

  const selectable = await getSelectableDates(page);
  const lo = Math.min(...timestamps), hi = Math.max(...timestamps);
  const fillsRange = selectable.every(t => t < lo || t > hi || timestamps.includes(t));
  const contiguous = timestamps.length > 1 && fillsRange &&
    timestamps.every(ts => selectable.includes(ts));

  if (contiguous) {
    await page.locator(`.warp-cal-day[data-ts="${lo}"]:not(.is-disabled)`).click();
    await page.locator(`.warp-cal-day[data-ts="${hi}"]:not(.is-disabled)`).click({ modifiers: ['Shift'] });
  } else {
    for (const ts of timestamps)
      await page.locator(`.warp-cal-day[data-ts="${ts}"]:not(.is-disabled)`).click();
  }
}

/** Drag-select from one cell to another (the ergonomic range path).
 *  Drags the mouse in steps so pointer events fire across cells. */
export async function dragSelectDates(page: Page, fromTs: number, toTs: number): Promise<void> {
  await clearSelection(page);
  const from = page.locator(`.warp-cal-day[data-ts="${fromTs}"]:not(.is-disabled)`);
  const to = page.locator(`.warp-cal-day[data-ts="${toTs}"]:not(.is-disabled)`);
  const fromBox = await from.boundingBox();
  const toBox = await to.boundingBox();
  if (!fromBox || !toBox) throw new Error('drag cells not visible');
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  // stepwise move to the target cell so pointermove fires
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(
      fromBox.x + (toBox.x - fromBox.x) * i / steps + fromBox.width / 2,
      fromBox.y + (toBox.y - fromBox.y) * i / steps + fromBox.height / 2,
    );
  }
  await page.mouse.up();
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

/** Click a seat by its stable OfficeMap id (#sprite-<sid>). Fits the map
 *  first so the seat is on-screen regardless of the 1:1 default view.
 *  On desktop the plan panel is now an inline column (no overlay), so it no
 *  longer obscures the leftmost seats; no panel-collapsing needed here. */
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
 * Click a zone action button (book/delete/update), wait for the apply response
 * and Flask teardown to commit the transaction. The zone-admin seat Edit /
 * Enable / Disable actions live in the #seat_edit_modal, not here.
 */
export async function clickActionBtn(
  page: Page,
  action: 'book' | 'delete' | 'update',
): Promise<void> {
  await Promise.all([
    page.waitForResponse(r => r.url().includes('/xhr/plan/apply') && r.status() === 200),
    page.locator(`.plan_action_btn[data-action="${action}"]`).click(),
  ]);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(200);
}

/** Activate book-for for the given display label (e.g. "Bar [user2]"). */
export async function activateBookFor(page: Page, label: string): Promise<void> {
  const bookForInput = page.locator('#book-for');
  await bookForInput.click();
  await bookForInput.pressSequentially(label.split(' ')[0], { delay: 50 });
  const item = page.locator('ul.autocomplete-content li', { hasText: label });
  await expect(item).toBeVisible({ timeout: 5000 });
  await item.click();
  // book-for fires a full getSeats?login= refresh; wait for it to settle.
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
}

/** Clear book-for (Enter on an empty input resets to the admin's own login). */
export async function clearBookFor(page: Page): Promise<void> {
  const bookForInput = page.locator('#book-for');
  await bookForInput.click();
  await bookForInput.fill('');
  await bookForInput.press('Enter');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(400);
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
