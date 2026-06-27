/**
 * iCal language (i18n) coverage.
 *
 * Feed event summaries (phrases: booking / missing / release) and the
 * action-page titles + button labels (Release seat? / Seat released /
 * Confirm / Cancel …) are rendered from the deployment language file
 * (LANGUAGE_FILE). Switched at runtime via the debug-only /debug/set_language
 * endpoint; the per-test fixture resets LANGUAGE_FILE to English afterwards.
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { getZoneSeats } from '../../helpers/booking';
import { insertBooking } from '../../helpers/bookings-page';
import { parseIcal, filterByUidPrefix, ICalEvent } from '../../helpers/ical';
import { setLanguage } from '../../helpers/debug';

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

// ─── Feed summaries follow LANGUAGE_FILE ────────────────────────────────────

test.describe('iCal feed text follows the deployment language', () => {
  test('German: booking summary uses "Platz {name}" and reminders "Platz in … buchen"', async ({ page }) => {
    await logIn(page, USER1);
    await setLanguage(page, 'de');

    // A real booking -> de phrase "Platz {name}" ("Platz 1.1").
    const [seat] = await getZoneSeats(1);
    await insertBooking(USER1.login, seat.id, 2);

    const token = await enableIcal(page);
    // Missing-booking reminder for zone 1 -> "Platz in {zone} buchen".
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

    const booking = events.find(e => /^[0-9]+@warp$/.test(e.uid));
    expect(booking, 'a booking VEVENT should be present').toBeTruthy();
    expect(booking!.summary).toContain('Platz ');        // de: "Platz 1.1"
    expect(booking!.summary).not.toContain('Seat ');     // English must not leak through

    const missing = filterByUidPrefix(events, 'missing-1-');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].summary).toContain('buchen');     // de: "Platz in Zone 1A buchen"
    expect(missing[0].summary).toContain('Zone 1A');
  });
});

// ─── Action-page text follows LANGUAGE_FILE ─────────────────────────────────

test.describe('iCal action-page text follows the deployment language', () => {
  test('German: release confirm page shows "Platz freigeben?" and Bestätigen/Abbrechen', async ({ page }) => {
    await logIn(page, USER1);
    await setLanguage(page, 'de');

    const [seat] = await getZoneSeats(1);
    const bookId = await insertBooking(USER1.login, seat.id, 2);
    const token = await enableIcal(page);

    const events = await fetchIcal(page, token);
    const ev = events.find(e => e.uid === `${bookId}@warp`);
    expect(ev?.url, 'booking VEVENT should carry a release link').toBeTruthy();

    await page.goto(ev!.url!);
    await expect(page.locator('.card-title')).toHaveText('Platz freigeben?');        // de: Release seat?
    await expect(page.locator('.confirm-links a.btn')).toHaveText('Bestätigen');      // de: Confirm
    await expect(page.locator('.confirm-links a.btn-flat')).toHaveText('Abbrechen');  // de: Cancel

    // Confirming shows the German "Seat released" message and removes the booking.
    await page.locator('.confirm-links a.btn').click();
    await expect(page.locator('.card-title')).toHaveText('Platz freigegeben');

    const rows = await querySql('SELECT id FROM book WHERE id = $1', [bookId]);
    expect(rows.rowCount).toBe(0);
  });
});
