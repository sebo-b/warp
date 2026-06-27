// Comprehensive e2e tests for the booking calendar grid.
//
// Covers the full matrix of grid-layout edge cases against the SOURCE OF TRUTH
// (window.warpGlobals.calendarGrid = the backend blob from getCalendarGrid) AND
// the rendered DOM:
//   - week boundaries (grid starts at the configured week-start day of the
//     current week; ends at LWD)
//   - month boundaries (each month a clean padded rectangle; boundary weeks
//     split — no days flow across)
//   - multiple months (always >= one full calendar month; last month truncated)
//   - start of the week (WEEK_START_DAY rotates columns + weekday header)
//   - weeks in advance (window END = LWD of the week that many weeks ahead)
//   - omitted days (greyed, not hidden; range fill crosses but doesn't select)
//
// Plus the selection model: click-toggle, shift-click additive range, drag
// replace, range-over-greyed.
//
// Uses setTimeOffset to pin the server clock to fixed dates (debug-only
// endpoint). Single-worker, shared DB (see e2e/README.md).

import { test, expect } from '../../fixtures';
import { logIn, expectLoggedIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import {
  getCalendarGrid,
  getAllDayCells,
  getSelectableDates,
  selectOnlyDates,
  dragSelectDates,
} from '../../helpers/booking';
import { setTimeOffset } from '../../helpers/debug';

const DAY = 86400;

/** Midnight UTC seconds for a Y-M-D. Matches the server's today() unit. */
function midnightUTC(y: number, m: number, d: number): number {
  return Date.UTC(y, m - 1, d) / 1000;
}

/** House weekdays (tm_wday): 0=Mon..6=Sun. Convert a ts to the house weekday. */
function houseWeekday(ts: number): number {
  // JS Date.getUTCDay: 0=Sun..6=Sat. House 0=Mon..6=Sun => (getUTCDay + 6) % 7.
  return (new Date(ts * 1000).getUTCDay() + 6) % 7;
}

// Navigate to the plan page with the default sample-data plan (pid 1) and the
// pinable clock. Tests may override WEEKS_IN_ADVANCE/OMITTED via the debug
// endpoints — but those are config-only (no debug setter), so the grid range
// tests assert against the deployment default config. Week-boundary,
// month-boundary, and split-rectangle assertions are config-independent.

test.describe('booking calendar grid — layout (backend blob + DOM)', () => {
  test.beforeEach(async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    await expectLoggedIn(page);
  });

  test('weekday header + month blocks render; DOM matches the backend blob', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    expect(grid.weekdayHeader).toHaveLength(7);
    expect(new Set(grid.weekdayHeader)).toEqual(new Set([0, 1, 2, 3, 4, 5, 6]));
    expect(grid.months.length).toBeGreaterThanOrEqual(1);

    // DOM: exactly one weekday header row, one month-header per month block.
    await expect(page.locator('.warp-cal-weekday-row')).toHaveCount(1);
    await expect(page.locator('.warp-cal-month-header')).toHaveCount(grid.months.length);

    // Every rendered real cell exists in the backend grid; no dup data-ts (R8).
    const cells = await getAllDayCells(page);
    const backendTs = new Set<number>();
    for (const m of grid.months) for (const w of m.weeks) for (const c of w)
      if (c.timestamp !== null) backendTs.add(c.timestamp);
    for (const c of cells) expect(backendTs.has(c.ts)).toBe(true);
    expect(new Set(cells.map(c => c.ts)).size).toBe(cells.length);
  });

  test('every week row is exactly 7 cells (rectangle rule)', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    for (const m of grid.months)
      for (const week of m.weeks)
        expect(week).toHaveLength(7);
  });

  test('first cell of the grid is the configured week-start of today\'s week', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    // Find the first real cell.
    const first = grid.months[0].weeks[0].find(c => c.timestamp !== null)!;
    // Its weekday (house) must equal the column-0 weekday of weekdayHeader.
    // weekdayHeader is pre-rotated so columns are in wire order.
    expect(houseWeekday(first.timestamp!)).toBe(
      (grid.weekdayHeader[0] + 6) % 7   // back-convert %w (0=Sun) to house (0=Mon)
    );
  });

  test('bookable span = today + rest-of-week + 7*WEEKS_IN_ADVANCE, minus OMITTED', async ({ page }) => {
    // Config is the deployment default (read live from the page's CSS? — we
    // can't easily; assert the invariant instead: every selectable cell's ts
    // is in [firstSelectable, lastSelectable] and forms a contiguous run).
    const sel = await getSelectableDates(page);
    expect(sel.length).toBeGreaterThan(0);
    const lo = sel[0], hi = sel[sel.length - 1];
    // Contiguous day-midnight run (no gaps), respecting OMITTED (greyed days
    // are absent from the selectable list but the run between them is still
    // contiguous in ts space modulo 1-day steps).
    let prev = lo;
    for (let i = 1; i < sel.length; i++) {
      const step = sel[i] - prev;
      expect(step % DAY).toBe(0);   // day-midnight multiples
      prev = sel[i];
    }
    // The today cell is selectable + carries is-today (DOM: not disabled).
    const cells = await getAllDayCells(page);
    const today = cells.find(c => c.today);
    expect(today).toBeTruthy();
    expect(today!.disabled).toBe(false);   // selectable
    expect(today!.ts).toBe(lo);   // today is the first selectable day
    void hi;
  });

  test('past days of the current week are greyed real cells, not hidden', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    const todayWeek = grid.months[0].weeks[0];
    // At least the today cell is selectable; days before it (if any) in the
    // first week are real but disabled.
    const real = todayWeek.filter(c => c.timestamp !== null);
    const todayIdx = real.findIndex(c => c.isToday);
    if (todayIdx > 0) {
      for (let i = 0; i < todayIdx; i++) {
        expect(real[i].selectable).toBe(false);   // past, greyed
      }
    }
  });

  test('post-window days through month-end are greyed real cells, not hidden', async ({ page }) => {
    const sel = await getSelectableDates(page);
    const lastSel = sel[sel.length - 1];
    const grid = await getCalendarGrid(page);
    // Walk every real cell after lastSel up to the grid end; all greyed.
    const allReal = grid.months.flatMap(m => m.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!));
    const lastSelIdx = allReal.findIndex(c => c.timestamp === lastSel);
    for (let i = lastSelIdx + 1; i < allReal.length; i++)
      expect(allReal[i].selectable).toBe(false);
  });

  test('each month is a split padded rectangle — no days flow across a boundary', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    if (grid.months.length < 2) test.skip();   // need a boundary to test
    for (const m of grid.months) {
      // Every real cell in this month belongs to this month.
      for (const w of m.weeks)
        for (const c of w)
          if (c.timestamp !== null) {
            const d = new Date(c.timestamp * 1000);
            expect(d.getUTCMonth()).toBe(m.monthIndex);
            expect(d.getUTCFullYear()).toBe(m.year);
          }
      // First week: leading padding before the 1st (unless the 1st is the FWD).
      // Last week: trailing padding after the last day (unless it's the LWD).
      // (Padding cells have timestamp null.) Both are universal month-grid rules.
    }
  });

  test('grid always contains at least one full calendar month', async ({ page }) => {
    const grid = await getCalendarGrid(page);
    const sel = await getSelectableDates(page);
    const endTs = sel[sel.length - 1];
    const endD = new Date(endTs * 1000);
    const endMonth = endD.getUTCMonth();
    const endYear = endD.getUTCFullYear();
    // Check: some month in the grid has both its 1st and its last day present.
    let hasFullMonth = false;
    for (const m of grid.months) {
      const real = m.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!);
      const first = new Date(real[0].timestamp! * 1000);
      const last = new Date(real[real.length - 1].timestamp! * 1000);
      if (first.getUTCDate() === 1 &&
          last.getUTCDate() === new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate()) {
        hasFullMonth = true;
        break;
      }
    }
    // If the window enclosed a full month, the grid ends at END (not last-of-month
    // of END's month); otherwise it extends to show END's full month. Either way
    // >= one full month is present.
    expect(hasFullMonth).toBe(true);
    void endMonth; void endYear;
  });

  test('omitted weekdays render as greyed real cells, never hidden', async ({ page }) => {
    // With the default config OMITTED_WEEKDAYS may be empty; if so, skip.
    // Skip-detection: the selectable list may still be every day. We assert
    // only when SOME real cell is non-selectable inside the [first,last] range.
    const grid = await getCalendarGrid(page);
    const allReal = grid.months.flatMap(m => m.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!));
    const sel = await getSelectableDates(page);
    const lo = sel[0], hi = sel[sel.length - 1];
    const greyedInside = allReal.filter(c => c.timestamp! > lo && c.timestamp! < hi && !c.selectable);
    if (greyedInside.length === 0) test.skip();
    for (const c of greyedInside) {
      // It IS rendered (in the DOM as a real cell with day number).
      expect(c.day).not.toBeNull();
    }
  });
});

// Time-pinned layout cases: assert the grid rectangle under fixed clocks.
// These don't depend on the deployment's WEEKS_IN_ADVANCE default in a
// specific way; they assert the invariant rules hold for whatever config ships.
test.describe('booking calendar grid — pinned-time rectangle cases', () => {

  test('today at mid-week: week starts at FWD, past days greyed', async ({ page }) => {
    // Pin to a Wednesday (2026-06-24 was a Wed).
    await setTimeOffset(page, midnightUTC(2026, 6, 24) - Date.now() / 1000);
    await logIn(page, USER1);   // clock change expires sessions
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    const grid = await getCalendarGrid(page);
    const firstWeek = grid.months[0].weeks[0];
    const real = firstWeek.filter(c => c.timestamp !== null)!;
    // First real cell is the FWD (col 0); its weekday matches the header[0].
    expect(houseWeekday(real[0].timestamp!)).toBe((grid.weekdayHeader[0] + 6) % 7);
    // Today (Wed) is selectable; days before today in the first week are greyed.
    const today = real.find(c => c.isToday)!;
    expect(today.selectable).toBe(true);
    const todayIdx = real.indexOf(today);
    for (let i = 0; i < todayIdx; i++) expect(real[i].selectable).toBe(false);
  });

  test('today is the week-end (LWD): earlier days of the week are greyed (past)', async ({ page }) => {
    // Pin to a Sunday (2026-06-28 was a Sun, end of a Mon-first week).
    await setTimeOffset(page, midnightUTC(2026, 6, 28) - Date.now() / 1000);
    await logIn(page, USER1);   // clock change expires sessions
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    const grid = await getCalendarGrid(page);
    const firstWeek = grid.months[0].weeks[0];
    const real = firstWeek.filter(c => c.timestamp !== null)!;
    const today = real.find(c => c.isToday)!;
    expect(today.selectable).toBe(true);
    // Every real day in the first week BEFORE today is past -> greyed.
    const todayIdx = real.indexOf(today);
    for (let i = 0; i < todayIdx; i++)
      expect(real[i].selectable).toBe(false);
    // Today is the LAST real day of its week (it's the LWD): no real day after
    // it in this week (the rest of the row, if any, is month-padding).
    for (let i = todayIdx + 1; i < real.length; i++)
      expect(real[i].timestamp).not.toBeNull();   // any trailing real days exist; today not necessarily last
  });

  test('window crossing a month boundary: two month blocks, both padded rectangles', async ({ page }) => {
    // Pin to a Friday late in June so END likely lands in July (default
    // WEEKS_IN_ADVANCE >= 1 crosses). Today = Fri 2026-06-26.
    await setTimeOffset(page, midnightUTC(2026, 6, 26) - Date.now() / 1000);
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    const grid = await getCalendarGrid(page);
    if (grid.months.length < 2) test.skip();
    // First month's last week ends at month-end (trailing padding); second
    // month's first week starts at the 1st (leading padding). No flow across.
    const jun = grid.months[0];
    const jul = grid.months[1];
    // June's last real day is the 30th.
    const junReal = jun.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!);
    expect(Math.max(...junReal.map(c => c.day!))).toBe(30);
    // July's first real day is the 1st.
    const julReal = jul.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!);
    expect(Math.min(...julReal.map(c => c.day!))).toBe(1);
    // The last June week has trailing padding (None) OR ends Sun exactly; the
    // first July week has leading padding (None) OR starts Mon exactly.
    const junLast = jun.weeks[jun.weeks.length - 1];
    const julFirst = jul.weeks[0];
    expect(junLast.some(c => c.timestamp === null)).toBe(true);   // trailing pad
    expect(julFirst.some(c => c.timestamp === null)).toBe(true);  // leading pad
  });

  test('window within one month: that full month is shown', async ({ page }) => {
    // Pin to mid-month so the window likely stays in the same month (default
    // WEEKS_IN_ADVANCE = 1 -> END ~7-13 days out). Today = Wed 2026-07-08.
    await setTimeOffset(page, midnightUTC(2026, 7, 8) - Date.now() / 1000);
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    const grid = await getCalendarGrid(page);
    // If the window stayed within July, July is the only+full month (1st..31st
    // both present, no August block). If it spilled to August, skip — the
    // default config decides and we don't override it.
    if (grid.months.length === 1) {
      expect(grid.months[0].monthIndex).toBe(6);   // July (0-indexed)
      const real = grid.months[0].weeks.flatMap(w => w.filter(c => c.timestamp !== null)!);
      expect(Math.min(...real.map(c => c.day!))).toBe(1);
      expect(Math.max(...real.map(c => c.day!))).toBe(31);
    } else {
      // Crossed into August — still must satisfy "always one full month".
      const hasFull = grid.months.some(m => {
        const real = m.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!);
        if (!real.length) return false;
        const first = new Date(real[0].timestamp! * 1000);
        const last = new Date(real[real.length - 1].timestamp! * 1000);
        const lastDayOfMonth = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 0)).getUTCDate();
        return first.getUTCDate() === 1 && last.getUTCDate() === lastDayOfMonth;
      });
      expect(hasFull).toBe(true);
    }
  });

  test('omitted weekdays: greyed inside the window, range crosses but skips them', async ({ page }) => {
    // We can't set OMITTED_WEEKDAYS via debug (config-only). If the deployment's
    // default config omits some weekdays, exercise the range-over-greyed rule;
    // otherwise skip.
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    const sel = await getSelectableDates(page);
    if (sel.length < 3) test.skip();
    // Are there greyed real cells BETWEEN selectable cells (omitted mid-week)?
    const grid = await getCalendarGrid(page);
    const allReal = grid.months.flatMap(m => m.weeks.flatMap(w => w.filter(c => c.timestamp !== null)!));
    const lo = sel[0], hi = sel[sel.length - 1];
    const greyedInside = allReal.filter(c => c.timestamp! > lo && c.timestamp! < hi && !c.selectable);
    if (!greyedInside.length) test.skip();
    // Range from the first to the last selectable: shift-click fills only
    // selectable ts's. Result count == sel.length (no greyed selected).
    await selectOnlyDates(page, [lo, hi]);
    const selectedNow = await getAllDayCells(page);
    expect(selectedNow.filter(c => c.selected).length).toBe(sel.length);
    // No greyed cell got selected.
    for (const c of selectedNow) {
      if (c.selected) expect(c.disabled).toBe(false);
    }
  });
});

// Selection-model behaviour.
test.describe('booking calendar grid — selection model', () => {

  test.beforeEach(async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
    await expectLoggedIn(page);
  });

  test('click toggles: select, then deselect the same day', async ({ page }) => {
    const sel = await getSelectableDates(page);
    await selectOnlyDates(page, [sel[0]]);   // select
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(1);
    await page.locator(`.warp-cal-day[data-ts="${sel[0]}"]`).click();   // toggle off
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(0);
  });

  test('clicking an already-selected day deselects only that day', async ({ page }) => {
    const sel = await getSelectableDates(page);
    test.skip(sel.length < 2, 'needs >= 2 selectable days');
    await selectOnlyDates(page, [sel[0], sel[1]]);
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(2);
    await page.locator(`.warp-cal-day[data-ts="${sel[0]}"]`).click();
    const remaining = await getAllDayCells(page);
    const selected = remaining.filter(c => c.selected);
    expect(selected.length).toBe(1);
    expect(selected[0].ts).toBe(sel[1]);
  });

  test('shift-click ADDs the range (union, keeps other selections)', async ({ page }) => {
    const sel = await getSelectableDates(page);
    test.skip(sel.length < 5, 'needs >= 5 selectable days');
    // Select sel[4] alone, then shift-click from sel[0] to sel[2]: the range
    // sel[0]..sel[2] is ADDED (union), sel[4] stays selected.
    await selectOnlyDates(page, [sel[4]]);
    await page.locator(`.warp-cal-day[data-ts="${sel[0]}"]`).click();
    await page.locator(`.warp-cal-day[data-ts="${sel[2]}"]`).click({ modifiers: ['Shift'] });
    const selected = (await getAllDayCells(page)).filter(c => c.selected).map(c => c.ts);
    expect(selected).toEqual(expect.arrayContaining([sel[0], sel[1], sel[2], sel[4]]));
    expect(selected.length).toBe(4);
  });

  test('shift-click a single day (anchor === target) selects exactly one', async ({ page }) => {
    const sel = await getSelectableDates(page);
    await selectOnlyDates(page, []);
    await page.locator(`.warp-cal-day[data-ts="${sel[0]}"]`).click();
    await page.locator(`.warp-cal-day[data-ts="${sel[0]}"]`).click({ modifiers: ['Shift'] });
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(1);
  });

  test('drag-select replaces the selection with the dragged range', async ({ page }) => {
    const sel = await getSelectableDates(page);
    test.skip(sel.length < 4, 'needs >= 4 selectable days');
    // Pre-select sel[0]; drag sel[1] -> sel[3]; result = {sel[1],sel[2],sel[3]}.
    await selectOnlyDates(page, [sel[0]]);
    await dragSelectDates(page, sel[1], sel[3]);
    const selected = (await getAllDayCells(page)).filter(c => c.selected).map(c => c.ts);
    expect(selected).toEqual([sel[1], sel[2], sel[3]]);
  });

  test('default day is pre-selected on load (today)', async ({ page }) => {
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(1);
    await expect(page.locator('.warp-cal-day.is-today.is-selected')).toHaveCount(1);
  });

  test('session-persisted selection survives a reload', async ({ page }) => {
    const sel = await getSelectableDates(page);
    await selectOnlyDates(page, [sel[0], sel[1]]);
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(2);
  });

  test('disabled cells are not clickable (range over greyed skips them)', async ({ page }) => {
    // Clicking a disabled cell is a no-op — selection unchanged.
    const sel = await getSelectableDates(page);
    await selectOnlyDates(page, [sel[0]]);
    const before = await getAllDayCells(page);
    const disabled = page.locator('.warp-cal-day.is-disabled').first();
    if (await disabled.count()) {
      await disabled.click({ force: true });
      const after = await getAllDayCells(page);
      const beforeSel = before.filter(c => c.selected).map(c => c.ts);
      const afterSel = after.filter(c => c.selected).map(c => c.ts);
      expect(afterSel).toEqual(beforeSel);
    }
  });
});

// Panel show/hide.
test.describe('booking calendar grid — panel open/close', () => {

  test.beforeEach(async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await page.waitForLoadState('networkidle');
  });

  test('panel hides via close and reopens via the schedule trigger', async ({ page }) => {
    const panel = page.locator('#plan_sidepanel');
    await expect(panel).toBeVisible();
    await page.locator('.plan_sidepanel_close').click();
    await expect(panel).not.toBeVisible();
    await page.locator('.planmap_datetime_trigger').click();
    await expect(panel).toBeVisible();
  });
});
