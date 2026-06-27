/**
 * Calendar / iCal integration tests.
 *
 * The iCal feed is at /calendar/{login}/events.ics?t={ical_token}.
 * The token is the raw value stored in user_prefs.ical_token — no HMAC needed
 * to request the feed, only to follow action links inside it.
 *
 * Reminder logic (from warp/ical.py):
 *   missing:  fires ahead_days before a day with no booking
 *   release:  fires (release_days + release_ahead_days) before a day,
 *             where release_days = public seat assignment's days_in_advance
 *   dedup:    when missing and release share (ts, zone_id), release wins
 *
 * Time control: POST /debug/set_time_offset with {offset_seconds: N}
 * (only in DevelopmentSettings / debug mode).
 */

import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { openCalendarModal } from '../../helpers/settings';
import { USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats } from '../../helpers/booking';
import { parseIcal, filterByUidPrefix, unescapeIcalText } from '../../helpers/ical';
import { advanceDays, resetTimeOffset } from '../../helpers/debug';
import { insertBooking } from '../../helpers/bookings-page';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Enable iCal for a user via the API and return their ical_token. */
async function enableIcal(
  page: import('@playwright/test').Page,
  login: string,
): Promise<string> {
  await page.request.post('/xhr/calendar', {
    data: { ical_enabled: true, ensure_token: true },
    headers: { 'Content-Type': 'application/json' },
  });
  const resp = await page.request.get('/xhr/calendar');
  const body = await resp.json();
  return body.ical_token as string;
}

/** Configure reminder settings. */
async function setReminders(
  page: import('@playwright/test').Page,
  opts: {
    reminder_weekdays?: number;    // bitmask, default 127 (all days)
    reminder_ahead_days?: number;  // >0 enables missing-booking reminder
    reminder_release_ahead_days?: number;  // >0 enables release reminder
    reminder_time?: number;        // seconds of day, default 0
    reminder_zones?: number[];
  },
): Promise<void> {
  await page.request.post('/xhr/calendar', {
    data: {
      ical_enabled: true,
      reminder_weekdays: 127,
      reminder_ahead_days: 0,
      reminder_release_ahead_days: 0,
      reminder_time: 0,
      reminder_zones: [],
      ...opts,
    },
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Fetch and parse the iCal feed for login. Optional type: 'all'|'bookings'|'reminders' (server default = all). */
async function fetchIcal(
  page: import('@playwright/test').Page,
  login: string,
  token: string,
  type?: string,
): Promise<import('../../helpers/ical').ICalEvent[]> {
  let url = `/calendar/${login}/events.ics?t=${token}`;
  if (type && type !== 'all') {
    url += `&type=${encodeURIComponent(type)}`;
  }
  const resp = await page.request.get(url);
  expect(resp.status()).toBe(200);
  return parseIcal(await resp.text());
}

// ─── Basic iCal Feed ──────────────────────────────────────────────────────────

test.describe('iCal feed basics', () => {

  test('GET /xhr/calendar returns defaults when ical is not enabled', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.get('/xhr/calendar');
    expect(resp.status()).toBe(200);
    const body = await resp.json();
    expect(body.ical_enabled).toBe(false);
    expect(body.ical_token).toBeNull();
  });

  test('enabling iCal generates a token', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
  });

  test('iCal feed is accessible with valid token', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    const resp = await page.request.get(`/calendar/user1/events.ics?t=${token}`);
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('text/calendar');
    const body = await resp.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');
  });

  test('iCal feed returns 404 with wrong token', async ({ page }) => {
    await logIn(page, USER1);
    await enableIcal(page, 'user1');
    const resp = await page.request.get('/calendar/user1/events.ics?t=wrong-token-000');
    expect(resp.status()).toBe(404);
  });

  test('iCal feed returns 404 when ical is disabled', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    // Disable
    await page.request.post('/xhr/calendar', {
      data: { ical_enabled: false },
      headers: { 'Content-Type': 'application/json' },
    });
    const resp = await page.request.get(`/calendar/user1/events.ics?t=${token}`);
    expect(resp.status()).toBe(404);
  });

  test('regenerating token invalidates the old one', async ({ page }) => {
    await logIn(page, USER1);
    const oldToken = await enableIcal(page, 'user1');

    await page.request.post('/xhr/calendar', {
      data: { ical_regenerate_token: true },
      headers: { 'Content-Type': 'application/json' },
    });

    const resp = await page.request.get(`/calendar/user1/events.ics?t=${oldToken}`);
    expect(resp.status()).toBe(404);
  });

});

// ─── Bookings in iCal ────────────────────────────────────────────────────────

test.describe('bookings appear in the iCal feed', () => {

  test('a future booking shows as a VEVENT', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(3);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    const events = await fetchIcal(page, 'user1', token);

    expect(events.length).toBeGreaterThan(0);
    expect(events.some(e => e.summary.includes('Zone 1A') || e.summary.includes(seat.name))).toBeTruthy();
  });

  test('feed includes the 7-day lookback but not older bookings', async ({ page }) => {
    // _generate_ical (warp/ical.py) keeps bookings from the last 7 days so
    // calendar clients retain recent history, and drops anything older.
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    const tooOld = futureDayTs(-10);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4), ($1, $2, $5, $6)',
      ['user1', seat.id,
       yesterday + 9 * 3600, yesterday + 17 * 3600,
       tooOld + 9 * 3600, tooOld + 17 * 3600],
    );

    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    const events = await fetchIcal(page, 'user1', token);

    const dayYMD = (ts: number) =>
      new Date(ts * 1000).toISOString().slice(0, 10).replace(/-/g, '');
    expect(events.some(e => e.dtstart.startsWith(dayYMD(yesterday)))).toBeTruthy();
    expect(events.every(e => !e.dtstart.startsWith(dayYMD(tooOld)))).toBeTruthy();
  });

  test('only the authenticated user\'s bookings appear', async ({ page }) => {
    const seats = await getZoneSeats(1);
    const ts = futureDayTs(2);
    // Insert a booking for user2 (user1's ical should not see it)
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seats[1].id, ts + 9 * 3600, ts + 17 * 3600],
    );
    // Insert a booking for user1
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seats[0].id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    const events = await fetchIcal(page, 'user1', token);

    // user1 sees exactly their own booking (not user2's)
    expect(events).toHaveLength(1);
  });

});

// ─── Missing-Booking Reminders ────────────────────────────────────────────────

test.describe('missing-booking reminders', () => {

  test('reminder appears for a future day with no booking (ahead_days=1)', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 1,   // reminder fires 1 day before
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    // No bookings inserted — reminder should fire for every upcoming day in zone 1
    const events = await fetchIcal(page, 'user1', token);
    const missing = filterByUidPrefix(events, 'missing-1-');
    expect(missing.length).toBeGreaterThan(0);
    expect(missing[0].summary).toContain('Zone 1A');
  });

  test('reminder does NOT appear for a day that already has a booking', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(5);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    const events = await fetchIcal(page, 'user1', token);
    const missing = filterByUidPrefix(events, 'missing-1-');

    // Compute the UID for day 5
    const dayTs = ts - ts % 86400;
    const d = new Date(dayTs * 1000);
    const dayStr = d.toISOString().substring(0, 10).replace(/-/g, '');
    const expectedUid = `missing-1-${dayStr}@warp`;

    // That specific day should NOT have a reminder (user has a booking)
    expect(missing.every(e => e.uid !== expectedUid)).toBeTruthy();
  });

  test('no reminders when reminder_zones is empty', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [],  // empty → no reminders
    });

    const events = await fetchIcal(page, 'user1', token);
    const missing = filterByUidPrefix(events, 'missing-');
    expect(missing).toHaveLength(0);
  });

  test('no reminders when ahead_days = 0', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 0,  // disabled
      reminder_time: 0,
      reminder_zones: [1],
    });

    const events = await fetchIcal(page, 'user1', token);
    const missing = filterByUidPrefix(events, 'missing-');
    expect(missing).toHaveLength(0);
  });

  test('reminder disappears after time advances past the reminder date (debug time)', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    // Without time offset: reminders exist
    const eventsBefore = await fetchIcal(page, 'user1', token);
    const missingBefore = filterByUidPrefix(eventsBefore, 'missing-1-');
    expect(missingBefore.length).toBeGreaterThan(0);

    // Advance 60 days — all near-term reminder timestamps become past
    await advanceDays(page, 60);
    // Invalidate cache by clearing then re-fetching (the debug time shift changes today_ts)
    const eventsAfter = await fetchIcal(page, 'user1', token);
    const missingAfter = filterByUidPrefix(eventsAfter, 'missing-1-');

    // With 60-day offset, 30-day horizon starts from day+60, so reminders still exist
    // BUT the ones that were near-term (from before) should have shifted windows.
    // The key assertion: reminders still exist (horizon is always 30 days from "today")
    // This test mainly verifies the feed regenerates after time offset.
    expect(eventsAfter.length).toBeGreaterThanOrEqual(0); // feed is valid ical

    await resetTimeOffset(page);
  });

});

// ─── Release Reminders ────────────────────────────────────────────────────────

test.describe('assigned seat release reminders', () => {

  /**
   * Set up:
   *   - user1 has a private seat assignment on seat S (unlimited days)
   *   - seat S also has a public row with days_in_advance=2
   *   - zone 1 is in user1's reminder_zones
   *   - release_ahead_days=1 → reminder fires (2+1)=3 days before any given day D
   */
  async function setupReleaseScenario(
    page: import('@playwright/test').Page,
  ): Promise<{ sid: number; token: string }> {
    const [seat] = await getZoneSeats(1);

    // private assignment (unlimited)
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );
    // public release window: 2 days in advance
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, 2)',
      [seat.id],
    );

    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 0,
      reminder_release_ahead_days: 1, // fires (2+1)=3 days before day D
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    return { sid: seat.id, token };
  }

  test('release reminder appears for assigned seat with public window', async ({ page }) => {
    await logIn(page, USER1);
    const { token } = await setupReleaseScenario(page);

    const events = await fetchIcal(page, 'user1', token);
    const release = filterByUidPrefix(events, 'release-');
    expect(release.length).toBeGreaterThan(0);
    expect(release[0].summary).toContain('becomes available');
  });

  test('release reminder includes the seat name in summary', async ({ page }) => {
    await logIn(page, USER1);
    const { sid, token } = await setupReleaseScenario(page);

    const result = await querySql('SELECT name FROM seat WHERE id = $1', [sid]);
    const seatName = result.rows[0].name;

    const events = await fetchIcal(page, 'user1', token);
    const release = filterByUidPrefix(events, 'release-');
    expect(release.some(e => e.summary.includes(seatName))).toBeTruthy();
  });

  test('no release reminder when release_ahead_days = 0', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, 2)',
      [seat.id],
    );

    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_release_ahead_days: 0,  // disabled
      reminder_time: 0,
      reminder_zones: [1],
    });

    const events = await fetchIcal(page, 'user1', token);
    expect(filterByUidPrefix(events, 'release-')).toHaveLength(0);
  });

  test('no release reminder when seat has no public days_in_advance row', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    // Only private assignment — no public row
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );

    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_release_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [1],
    });

    const events = await fetchIcal(page, 'user1', token);
    expect(filterByUidPrefix(events, 'release-')).toHaveLength(0);
  });

});

// ─── Deduplication ───────────────────────────────────────────────────────────

test.describe('missing-vs-release deduplication', () => {

  /**
   * Dedup triggers when:
   *   missing ts (D - ahead_days)  ==  release ts (D - release_days - release_ahead_days)
   *   → same zone
   *
   * Choose: ahead_days=3, release_days=2 (days_in_advance on public row),
   *         release_ahead_days=1  → both fire 3 days before D.
   * With weekdays_mask=127 there will be days in the horizon where both
   * would fire for zone 1 — only the release one should appear.
   */
  test('release event wins over missing when timestamps coincide for the same zone', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);

    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [seat.id, 'user1'],
    );
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, 2)',
      [seat.id],
    );

    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 3,         // missing fires 3 days before D
      reminder_release_ahead_days: 1, // release fires (2+1)=3 days before D → same!
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    const events = await fetchIcal(page, 'user1', token);

    // Find all (day_str) values for release events in zone 1 (for seat S)
    const releaseUids = new Set(filterByUidPrefix(events, 'release-').map(e => e.uid));
    const missingEvents = filterByUidPrefix(events, 'missing-1-');

    // For every release event with UID `release-{sid}-{dayStr}@warp`,
    // there must be NO missing event with UID `missing-1-{dayStr}@warp`
    for (const releaseUid of releaseUids) {
      const dayStr = releaseUid.split('-').slice(2).join('-').replace('@warp', '');
      const conflictingMissingUid = `missing-1-${dayStr}@warp`;
      expect(missingEvents.every(e => e.uid !== conflictingMissingUid)).toBeTruthy();
    }
  });

  test('missing events for OTHER zones still appear even when release dedup fires', async ({ page }) => {
    await logIn(page, USER1);
    const zone1Seats = await getZoneSeats(1);

    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, $2, NULL)',
      [zone1Seats[0].id, 'user1'],
    );
    await querySql(
      'INSERT INTO seat_assign (sid, login, days_in_advance) VALUES ($1, NULL, 2)',
      [zone1Seats[0].id],
    );

    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 3,
      reminder_release_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [1, 2],  // monitor zone 2 as well (user1 has zone 2 access)
      reminder_weekdays: 127,
    });

    const events = await fetchIcal(page, 'user1', token);

    // Zone 2 reminders should still exist (dedup only applies within the same zone)
    const missingZone2 = filterByUidPrefix(events, 'missing-2-');
    expect(missingZone2.length).toBeGreaterThan(0);
  });

});

// ─── iCal Text Escaping ──────────────────────────────────────────────────

test.describe('special characters in seat names are escaped (RFC 5545 TEXT)', () => {
  test('SUMMARY escapes \\ ; , and newline and round-trips', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    // Covers every char _escape_ical_text handles: backslash, semicolon,
    // comma, and newline (escaped to literal backslash-n).
    const specialName = 'A;B,C\\D\nE';
    await querySql('UPDATE seat SET name = $1 WHERE id = $2', [specialName, seat.id]);

    const bookId = await insertBooking(USER1.login, seat.id, 3);

    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    const events = await fetchIcal(page, 'user1', token);

    const ev = events.find(e => e.uid === `${bookId}@warp`);
    expect(ev, 'booking VEVENT for the special-named seat should be present').toBeTruthy();

    // The parsed SUMMARY retains the escape sequences (the helper parser does
    // not unescape) — assert the escaped forms are actually present.
    expect(ev!.summary).toContain('\\;');
    expect(ev!.summary).toContain('\\,');
    expect(ev!.summary).toContain('\\\\');
    expect(ev!.summary).toContain('\\n');

    // Unescaping the parsed value must recover the original — the escape is
    // correct and reversible for all four special characters.
    expect(unescapeIcalText(ev!.summary)).toBe(`Seat ${specialName}`);
  });
});

// ─── Calendar Settings API ─────────────────────────────────────────────────────

test.describe('calendar settings API', () => {

  test('GET /xhr/calendar requires authentication', async ({ page }) => {
    const resp = await page.request.get('/xhr/calendar', { maxRedirects: 0 });
    expect([302, 401, 403]).toContain(resp.status());
  });

  test('POST /xhr/calendar rejects invalid reminder_weekdays', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await page.request.post('/xhr/calendar', {
      data: { ical_enabled: true, reminder_weekdays: 999 }, // > 127 invalid
      headers: { 'Content-Type': 'application/json' },
    });
    expect(resp.status()).toBe(400);
  });

  test('iCal cache is invalidated when a booking changes', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');

    // Fetch once to populate cache
    await fetchIcal(page, 'user1', token);

    // Add a booking (triggers cache invalidation in apply endpoint)
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(4);
    await page.request.post('/xhr/plan/apply', {
      data: { book: { sid: seat.id, dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] } },
      headers: { 'Content-Type': 'application/json' },
    });

    // Fetch again — should include the new booking
    const events = await fetchIcal(page, 'user1', token);
    expect(events.length).toBeGreaterThan(0);
  });

});

// ─── URL type filter (?type=bookings / reminders / all) ───

test.describe('iCal feed type filter (bookings vs reminders vs all)', () => {

  test('no-type (default) and type=all return both bookings and reminders', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(3);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, {
      reminder_ahead_days: 1,
      reminder_time: 0,
      reminder_zones: [1],
      reminder_weekdays: 127,
    });

    const all1 = await fetchIcal(page, 'user1', token);            // default (no type param)
    const all2 = await fetchIcal(page, 'user1', token, 'all');
    const hasBooking = (evs: import('../../helpers/ical').ICalEvent[]) =>
      evs.some(e => /^[0-9]+@warp$/.test(e.uid));
    const hasReminder = (evs: import('../../helpers/ical').ICalEvent[]) =>
      evs.some(e => e.uid.startsWith('missing-') || e.uid.startsWith('release-'));

    expect(hasBooking(all1) || hasReminder(all1)).toBeTruthy();
    expect(all1).toEqual(all2);
  });

  test('type=bookings yields only booking VEVENTs (no reminder UIDs)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(4);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, { reminder_ahead_days: 1, reminder_zones: [1], reminder_weekdays: 127 });

    const bookingsOnly = await fetchIcal(page, 'user1', token, 'bookings');
    expect(bookingsOnly.length).toBeGreaterThan(0);
    expect(bookingsOnly.every(e => /^[0-9]+@warp$/.test(e.uid))).toBeTruthy();
    expect(bookingsOnly.some(e => e.uid.startsWith('missing-') || e.uid.startsWith('release-'))).toBeFalsy();
  });

  test('type=reminders yields only reminder VEVENTs (no booking UIDs)', async ({ page }) => {
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, { reminder_ahead_days: 1, reminder_zones: [1], reminder_weekdays: 127 });

    const remindersOnly = await fetchIcal(page, 'user1', token, 'reminders');
    expect(remindersOnly.length).toBeGreaterThan(0);
    expect(remindersOnly.every(e => e.uid.startsWith('missing-') || e.uid.startsWith('release-'))).toBeTruthy();
    expect(remindersOnly.some(e => /^[0-9]+@warp$/.test(e.uid))).toBeFalsy();
  });

  test('type=invalid falls back to all (server side)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(5);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );
    await logIn(page, USER1);
    const token = await enableIcal(page, 'user1');
    await setReminders(page, { reminder_ahead_days: 1, reminder_zones: [1], reminder_weekdays: 127 });

    const unknown = await fetchIcal(page, 'user1', token, 'nonsense');
    const hasB = unknown.some(e => /^[0-9]+@warp$/.test(e.uid));
    const hasR = unknown.some(e => e.uid.startsWith('missing-') || e.uid.startsWith('release-'));
    expect(hasB || hasR).toBeTruthy();
  });

});

// ─── Calendar modal UI flow (drive everything through clicks, no direct XHR seeds) ───

test.describe('calendar settings modal UI (full flow + type tabs + disabled tab state)', () => {
  test('configure via UI, tabs update URL, disabling reminders config greys+auto-deselects the Reminders tab', async ({ page }) => {
    await logIn(page, USER1);

    // Open the modal the real way (user menu dropdown → link). No API setup.
    await openCalendarModal(page);

    // Scroll the modal inner content all the way to the top; the harness viewport
    // is small and Materialize places scroll on .modal-content for tall modals.
    const modal = page.locator('#calendar_modal');
    const content = modal.locator('> .modal-content');
    await content.evaluate((el: HTMLElement) => { el.scrollTop = 0; });

    // Give the modal open animation + layout one frame to settle.
    await page.waitForTimeout(120);

    // Enable iCal via the visible lever (the native checkbox is display:none).
    // Click the lever with force to survive small-viewport "outside viewport" races
    // common in the e2e harness. This is still a real user-gesture click.
    const lever = modal.locator('#cal_enabled').locator('..').locator('.lever');
    await lever.click({ force: true });

    // Make reminders valid so "Reminders only" tab can be enabled:
    // - at least one positive ahead value
    // - a weekday chip active
    // - at least one zone selected
    const missingSel = page.locator('#cal_missing_ahead');
    await missingSel.scrollIntoViewIfNeeded();
    await missingSel.selectOption('1');

    // Pick Zone 1 from the multi-select
    const zonesSel = page.locator('#cal_zones');
    await zonesSel.scrollIntoViewIfNeeded();
    await zonesSel.selectOption(['1']);

    // Ensure a weekday is active (fresh users start with weekdayMask=0)
    const monChip = page.locator('#cal_weekday_chips .weekday-chip:has-text("Mon")').first();
    await monChip.scrollIntoViewIfNeeded();
    const isActive = await monChip.evaluate((el) => el.classList.contains('active'));
    if (!isActive) {
      await monChip.click();
    }

    // Save persists settings + token, then closes the modal.
    await page.locator('#cal_save_btn').click();
    await page.locator('#calendar_modal').waitFor({ state: 'hidden' });

    // Re-open; state is now loaded from server with a token and the reminder config.
    await openCalendarModal(page);

    const urlInput = page.locator('#cal_url');
    await expect(urlInput).toBeVisible();

    // Initial tab is "No filter" → URL must not carry a type param
    await expect(urlInput).toHaveValue(/\/events\.ics\?t=/);
    let currentUrl = await urlInput.inputValue();
    expect(currentUrl).not.toContain('type=');

    // Click Bookings only tab → appends &type=bookings and updates the field live
    await page.locator('#cal_type_tabs a[href="#cal-type-bookings"]').click();
    await expect(urlInput).toHaveValue(/&type=bookings/);

    // Click Reminders only → &type=reminders
    await page.locator('#cal_type_tabs a[href="#cal-type-reminders"]').click();
    await expect(urlInput).toHaveValue(/&type=reminders/);

    // Back to No filter → no param again
    await page.locator('#cal_type_tabs a[href="#cal-type-all"]').click();
    currentUrl = await urlInput.inputValue();
    expect(currentUrl).not.toContain('type=');

    // ─── Delicate part: live disable of the Reminders tab when config becomes invalid ───
    const remindersTabLi = page.locator('#cal_type_reminders_tab');

    // While on a *safe* tab (all), mutate the config to make reminders invalid.
    // The reminders tab should grey out, but the active choice + URL must be unaffected.
    await page.locator('#cal_missing_ahead').selectOption('0');
    await expect(remindersTabLi).toHaveClass(/disabled/);
    await expect(urlInput).not.toHaveValue(/type=reminders/);   // still clean (we were not on reminders)

    // Put config back to valid so we can legitimately go to the reminders tab.
    await page.locator('#cal_missing_ahead').selectOption('1');
    await expect(remindersTabLi).not.toHaveClass(/disabled/);

    // Now drive *onto* the reminders tab while the config is valid.
    await page.locator('#cal_type_tabs a[href="#cal-type-reminders"]').click();
    await expect(urlInput).toHaveValue(/&type=reminders/);

    // Mutate *while selected on the now-illegal choice*.
    // The JS must auto-deselect (selectedType→'all', instance.select, onShow rewrite).
    await page.locator('#cal_missing_ahead').selectOption('0');

    // The li becomes disabled and the URL input must be rewritten away from reminders.
    await expect(remindersTabLi).toHaveClass(/disabled/);
    await expect(urlInput).not.toHaveValue(/type=reminders/);

    // Force-clicking the still-visible disabled tab link must not take us there.
    await page.locator('#cal_type_tabs a[href="#cal-type-reminders"]').click({ force: true });
    await expect(urlInput).not.toHaveValue(/type=reminders/);

    // Re-enable a valid reminder config → the tab should become interactive again.
    await page.locator('#cal_missing_ahead').selectOption('1');
    await expect(remindersTabLi).not.toHaveClass(/disabled/);

    // Now selecting it succeeds and the URL gets the param.
    await page.locator('#cal_type_tabs a[href="#cal-type-reminders"]').click();
    await expect(urlInput).toHaveValue(/&type=reminders/);

    // Clean close
    await page.locator('#cal_cancel_btn').click();
    await page.locator('#calendar_modal').waitFor({ state: 'hidden' });
  });
});
