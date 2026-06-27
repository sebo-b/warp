/**
 * Zone view UI affordances (FEATURES.md §7.7, §7.8, §10, §18):
 * seat name labels, booking preview labels, hover tooltip, the help legend
 * modal, shift-select for dates, and sessionStorage selection persistence.
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';
import { apiSetPrefs } from '../../helpers/settings';
import { insertBooking } from '../../helpers/bookings-page';
import {
  futureDayTs,
  getZoneSeats,
  getSelectableDates,
  selectOnlyDates,
  waitForSeatsLoaded,
} from '../../helpers/booking';
import { assignSeat } from '../../helpers/zone-setup';

test.describe('zone map help legend', () => {

  test('help icon opens the legend modal with seat icon explanations', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await page.locator('.planmap_help').first().click();
    const modal = page.locator('#planmap_help_modal');
    await expect(modal).toHaveClass(/open/);
    // The legend explains the seat sprites (book, rebook, conflict, taken, …).
    expect(await modal.locator('.help_modal_sprite').count()).toBeGreaterThanOrEqual(5);
  });
});

test.describe('seat name and booking preview labels', () => {

  test('seat name labels appear when the preference is enabled', async ({ page }) => {
    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_seat_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator('.OMLabelTitle', { hasText: '1.1' })).toBeVisible();
  });

  test('no labels are shown when both preferences are disabled', async ({ page }) => {
    await logIn(page, USER1);
    await apiSetPrefs(page, {
      zone_show_seat_names: false,
      zone_show_booking_preview: false,
    });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const [seat] = await getZoneSeats(1);
    await expect(page.locator(`#sprite-${seat.id} .OMLabel`)).toBeHidden();
  });

  test('booking labels never show zone info even on multi-zone plans', async ({ page }) => {
    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_seat_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    // Zone info (.seat_label_zone) must never appear on booking-pane labels
    await expect(page.locator('.seat_label_zone')).toHaveCount(0);
  });

  test('booking preview labels show who is booked for the selected date', async ({ page }) => {
    const ts = futureDayTs(1);
    const [seat] = await getZoneSeats(1);
    await insertBooking(USER2.login, seat.id, 1);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_booking_preview: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER2.name })).toBeVisible();
  });

  test('booking preview labels update when the date selection changes', async ({ page }) => {
    const ts = futureDayTs(1);
    const [seat] = await getZoneSeats(1);
    await insertBooking(USER2.login, seat.id, 1);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_booking_preview: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);
    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER2.name })).toBeVisible();

    // Deselect every date — the preview label must disappear in place.
    await selectOnlyDates(page, []);
    await page.waitForTimeout(400);
    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`)).toHaveCount(0);
  });
});

test.describe('seat hover tooltip', () => {

  test('hovering a booked seat shows the preview with seat name and booking', async ({ page }) => {
    const ts = futureDayTs(1);
    const [seat] = await getZoneSeats(1);
    await insertBooking(USER2.login, seat.id, 1);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    await page.locator(`#sprite-${seat.id}`).hover();
    const preview = page.locator('.seat_preview');
    await expect(preview).toBeVisible();
    await expect(preview.locator('.seat_preview_title')).toContainText(seat.name);
    await expect(preview).toContainText('Bookings:');
    await expect(preview).toContainText(USER2.name);
  });

  test('tooltip disappears on mouse-out', async ({ page }) => {
    const [seat] = await getZoneSeats(1);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await page.locator(`#sprite-${seat.id}`).hover();
    await expect(page.locator('.seat_preview')).toBeVisible();

    await page.mouse.move(1, 1);
    await expect(page.locator('.seat_preview')).toBeHidden();
  });
});

test.describe('date selection UX', () => {

  test('range fills the contiguous run (click start, shift-click end)', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const selectable = await getSelectableDates(page);
    test.skip(selectable.length < 4, 'needs at least 4 selectable dates');

    await selectOnlyDates(page, []);   // clear (toggle each selected off)
    // Click the first selectable day (sets the anchor), then shift-click the
    // fourth: shift-click ADDs the anchor..target range (union).
    await page.locator(`.warp-cal-day[data-ts="${selectable[0]}"]`).click();
    await page.locator(`.warp-cal-day[data-ts="${selectable[3]}"]`).click({ modifiers: ['Shift'] });
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(4);
  });

  test('clicking a selected day deselects it (toggle)', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    const selectable = await getSelectableDates(page);
    expect(selectable.length).toBeGreaterThanOrEqual(1);

    await selectOnlyDates(page, [selectable[0]]);
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(1);
    // Click it again -> toggled off (no clear-link; the only deselect path).
    await page.locator(`.warp-cal-day[data-ts="${selectable[0]}"]`).click();
    await expect(page.locator('.warp-cal-day.is-selected')).toHaveCount(0);
  });

  test('selected dates persist across a page reload (sessionStorage)', async ({ page }) => {
    const ts = futureDayTs(1);

    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);

    await page.reload();
    await waitForSeatsLoaded(page);

    // The selected-day cell carries the .is-selected class with data-ts === ts;
    // every other cell is not selected.
    const selected = page.locator('.warp-cal-day.is-selected');
    expect(await selected.count()).toBe(1);
    expect(await selected.getAttribute('data-ts')).toBe(String(ts));
  });
});

test.describe('assigned-names labels', () => {

  test('no assigned label when pref is off', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, USER2.login, null);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_assigned_names: false });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`)).toHaveCount(0);
  });

  test('assigned label shown when pref is on', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, USER2.login, null);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_assigned_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER2.name })).toBeVisible();
  });

  test('booking preview wins over assigned names', async ({ page }) => {
    const ts = futureDayTs(1);
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, USER2.login, null);
    await insertBooking(USER2.login, seat.id, 1);

    await logIn(page, USER1);
    await apiSetPrefs(page, {
      zone_show_booking_preview: true,
      zone_show_assigned_names: true,
    });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);
    await selectOnlyDates(page, [ts]);
    await page.waitForTimeout(400);

    // The seat has a booking overlapping the selected date, so booking preview wins.
    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER2.name })).toBeVisible();
    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`)).toHaveCount(1);
  });

  test('everyone-only seat not shown', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, null, null);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_assigned_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`)).toHaveCount(0);
  });

  test('limited days_in_advance not shown', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, USER2.login, 3);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_assigned_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`)).toHaveCount(0);
  });

  test('multi-user assignment shows all names', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await assignSeat(seat.id, USER2.login, null);
    // USER3 needs to be a real user in the DB — e2e/sql/sample_data.sql creates user3.
    await assignSeat(seat.id, USER3.login, null);

    await logIn(page, USER1);
    await apiSetPrefs(page, { zone_show_assigned_names: true });

    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER2.name })).toBeVisible();
    await expect(page.locator(`#sprite-${seat.id} .seat_label_name`, { hasText: USER3.name })).toBeVisible();
  });
});
