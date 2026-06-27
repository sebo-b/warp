/**
 * iCal one-click action pages (FEATURES.md §15.4, §15.5, §17).
 *
 * Every booking VEVENT in the feed carries a release link
 * (/calendar/{login}/delete?i=&n=&t=) and every missing-booking reminder
 * carries a book link (/calendar/{login}/book?z=&d=&n=&t=). The links are
 * HMAC-signed with the user's ical_token, so no login session is needed to
 * follow them — exactly how a calendar app would.
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats } from '../../helpers/booking';
import { parseIcal, filterByUidPrefix, ICalEvent } from '../../helpers/ical';
import { insertBooking } from '../../helpers/bookings-page';
import { advanceDays } from '../../helpers/debug';

type Page = import('@playwright/test').Page;

/** Enable iCal for the logged-in user and return their ical_token. */
async function enableIcal(page: Page): Promise<string> {
  await page.request.post('/xhr/calendar', {
    data: { ical_enabled: true, ensure_token: true },
    headers: { 'Content-Type': 'application/json' },
  });
  const resp = await page.request.get('/xhr/calendar');
  const body = await resp.json();
  return body.ical_token as string;
}

/** Fetch and parse the feed for user1. */
async function fetchIcal(page: Page, token: string): Promise<ICalEvent[]> {
  const resp = await page.request.get(`/calendar/user1/events.ics?t=${token}`);
  expect(resp.status()).toBe(200);
  return parseIcal(await resp.text());
}

/** Book a seat for user1 and return the release URL from its feed VEVENT. */
async function getReleaseLink(page: Page, token: string): Promise<{ url: string; bookId: number }> {
  const seats = await getZoneSeats(1);
  const bookId = await insertBooking(USER1.login, seats[0].id, 1);
  const events = await fetchIcal(page, token);
  const event = events.find(e => e.uid === `${bookId}@warp`);
  expect(event, 'booking VEVENT should be in the feed').toBeTruthy();
  expect(event!.url, 'booking VEVENT should carry a release link').toBeTruthy();
  return { url: event!.url!, bookId };
}

/**
 * Enable the missing-booking reminder and return the book URL for zone 1
 * with the earliest action date (its `d` query param), plus that date.
 */
async function getBookLink(page: Page, token: string): Promise<{ url: string; day: string }> {
  await page.request.post('/xhr/calendar', {
    data: {
      ical_enabled: true,
      reminder_weekdays: 127,
      reminder_ahead_days: 1,
      reminder_release_ahead_days: 0,
      reminder_time: 0,
      reminder_zones: [1],
    },
    headers: { 'Content-Type': 'application/json' },
  });
  const events = await fetchIcal(page, token);
  const missing = filterByUidPrefix(events, 'missing-1-').filter(e => e.url);
  expect(missing.length, 'missing reminders should carry book links').toBeGreaterThan(0);
  const withDay = missing
    .map(e => ({ url: e.url!, day: new URL(e.url!).searchParams.get('d')! }))
    .sort((a, b) => a.day.localeCompare(b.day));
  return withDay[0];
}

/** Whole days from today (UTC midnight) until an ISO date string. */
function daysUntil(day: string): number {
  const target = Date.UTC(
    Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  const now = new Date();
  const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - todayMidnight) / 86400000);
}

// ─── Release link (two-step delete) ──────────────────────────────────────────

test.describe('release seat via calendar link', () => {

  test('release link shows the confirmation page with the seat name', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getReleaseLink(page, token);

    await page.goto(url);
    await expect(page.locator('.card-title')).toHaveText('Release seat?');
    await expect(page.locator('.card-content p')).toHaveText('1.1');
    await expect(page.locator('.confirm-links a.btn')).toHaveText('Confirm');
    await expect(page.locator('.confirm-links a.btn-flat')).toHaveText('Cancel');
  });

  test('confirming removes the booking and shows "Seat released"', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url, bookId } = await getReleaseLink(page, token);

    await page.goto(url);
    await page.locator('.confirm-links a.btn').click();
    await expect(page.locator('.card-title')).toHaveText('Seat released');
    await expect(page.locator('.card-content p')).toHaveText('1.1');

    const rows = await querySql('SELECT id FROM book WHERE id = $1', [bookId]);
    expect(rows.rowCount).toBe(0);
  });

  test('cancelling keeps the booking and shows "Action cancelled"', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url, bookId } = await getReleaseLink(page, token);

    await page.goto(url);
    await page.locator('.confirm-links a.btn-flat').click();
    await expect(page.locator('.card-title')).toHaveText('Action cancelled');

    const rows = await querySql('SELECT id FROM book WHERE id = $1', [bookId]);
    expect(rows.rowCount).toBe(1);
  });

  test('tampered release token is rejected with Forbidden', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url, bookId } = await getReleaseLink(page, token);

    const forged = url.replace(/t=[0-9a-f]+/, 't=' + '0'.repeat(64));
    const resp = await page.request.get(forged);
    expect(resp.status()).toBe(403);
    expect(await resp.text()).toContain('Forbidden');

    const rows = await querySql('SELECT id FROM book WHERE id = $1', [bookId]);
    expect(rows.rowCount).toBe(1);
  });

  test('past bookings cannot be released via the link', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    // Yesterday's booking is within the feed's 7-day lookback but in the past.
    const seats = await getZoneSeats(1);
    const bookId = await insertBooking(USER1.login, seats[0].id, -1);

    const events = await fetchIcal(page, token);
    const event = events.find(e => e.uid === `${bookId}@warp`);
    expect(event?.url).toBeTruthy();

    await page.goto(event!.url!);
    await expect(page.locator('.card-title')).toHaveText('Reservation in the past');

    const rows = await querySql('SELECT id FROM book WHERE id = $1', [bookId]);
    expect(rows.rowCount).toBe(1);
  });

  test('regenerating the feed token invalidates outstanding release links', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getReleaseLink(page, token);

    await page.request.post('/xhr/calendar', {
      data: { ical_regenerate_token: true },
      headers: { 'Content-Type': 'application/json' },
    });

    const resp = await page.request.get(url);
    expect(resp.status()).toBe(403);
  });
});

// ─── Book link (missing-booking reminder) ────────────────────────────────────

test.describe('book seat via calendar link', () => {

  test('book link auto-books a seat and shows "Seat Booked"', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getBookLink(page, token);

    await page.goto(url);
    await expect(page.locator('.card-title')).toHaveText('Seat Booked');
    await expect(page.locator('.card-content p')).toContainText('Zone 1A');

    const rows = await querySql('SELECT sid FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(1);
  });

  test('book link reports "Seat Already Booked" when same-zone booking exists', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url, day } = await getBookLink(page, token);

    // Pre-book a seat in Zone 1A (same zone the link targets).
    const zone1Seats = await getZoneSeats(1);
    await insertBooking(USER1.login, zone1Seats[0].id, daysUntil(day));

    await page.goto(url);
    await expect(page.locator('.card-title')).toHaveText('Seat Already Booked');
    await expect(page.locator('.card-content p')).toContainText('Zone 1A');

    // No second booking was created.
    const rows = await querySql('SELECT sid FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(1);
  });

  test('tampered book token is rejected with Forbidden', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getBookLink(page, token);

    const forged = url.replace(/t=[0-9a-f]+/, 't=' + '0'.repeat(64));
    const resp = await page.request.get(forged);
    expect(resp.status()).toBe(403);

    const rows = await querySql('SELECT sid FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(0);
  });

  test('book link for a past date reports "Requested date is in the past"', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url, day } = await getBookLink(page, token);

    await advanceDays(page, daysUntil(day) + 1); // the link's date is now in the past

    await page.goto(url);
    await expect(page.locator('.card-title')).toHaveText('Requested date is in the past');

    const rows = await querySql('SELECT sid FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(0);
  });

  test('book link is rejected after iCal is disabled', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getBookLink(page, token);

    await page.request.post('/xhr/calendar', {
      data: { ical_enabled: false },
      headers: { 'Content-Type': 'application/json' },
    });

    const resp = await page.request.get(url);
    expect(resp.status()).toBe(403);
  });
});

// ─── No seat available (booked=[] path) ─────────────────────────────────────

test.describe('book link reports "Not possible to book"', () => {
  test('when no seat in the target zone is available', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getBookLink(page, token);

    // ponytail: disabling every seat in the zone is the deterministic way to
    // force runAutoBook's booked=[] branch. The real "zone full" cause needs
    // one booking per seat (~27 distinct accounts — infeasible with 4 test
    // users). A timedrift into the past would instead yield "Requested date is
    // in the past"; a future-beyond-window approach couples to WEEKS_IN_ADVANCE.
    await querySql('UPDATE seat SET enabled = false WHERE zid = $1', [1]);

    await page.goto(url);
    await expect(page.locator('.card-title')).toHaveText('Not possible to book');

    const rows = await querySql('SELECT id FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(0);
  });
});

// ─── Lost zone access (valid HMAC, role revoked) ────────────────────────────

test.describe('book link 403 when zone access was revoked', () => {
  test('valid HMAC but user no longer holds the zone role -> Forbidden', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page);
    const { url } = await getBookLink(page, token);

    // user1's only zone-1 grant is the direct zone_assign(1,'user1',10) row
    // (group_1a grants user2, not user1; zone 1 is type ENABLED, no synthetic
    // public row). The materialized-view trigger refreshes effective roles on
    // delete, so book_seat's specific_role lookup returns None -> 403.
    await querySql("DELETE FROM zone_assign WHERE zid = 1 AND login = 'user1'");

    const resp = await page.request.get(url);
    expect(resp.status()).toBe(403);
    expect(await resp.text()).toContain('Forbidden');

    const rows = await querySql('SELECT id FROM book WHERE login = $1', [USER1.login]);
    expect(rows.rowCount).toBe(0);
  });
});

// ─── Input validation 400s (param guards, run before token verification) ──────

// The malformed-DATE 400 in book_seat (timegm parse) is NOT tested: that branch
// sits after the HMAC check, and d is part of the signed message, so a tampered
// date is rejected as 403 before reaching the parse guard. It is defensive.
// The missing-param / non-integer guards below run first, token-free.

test.describe('iCal action-link input validation (400 Bad Request)', () => {
  test('book link with no parameters -> 400 Error', async ({ page }) => {
    const resp = await page.request.get('/calendar/user1/book');
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain('card-title">Error');
  });

  test('book link with non-integer zone -> 400 Error', async ({ page }) => {
    const resp = await page.request.get('/calendar/user1/book?z=notanint&d=2026-07-01&n=1&t=1');
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain('card-title">Error');
  });

  test('delete link with no parameters -> 400 Error', async ({ page }) => {
    const resp = await page.request.get('/calendar/user1/delete');
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain('card-title">Error');
  });

  test('delete link with non-integer booking id -> 400 Error', async ({ page }) => {
    const resp = await page.request.get('/calendar/user1/delete?i=notanint&n=1&t=1');
    expect(resp.status()).toBe(400);
    expect(await resp.text()).toContain('card-title">Error');
  });
});
