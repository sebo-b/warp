/**
 * Per-plan timezone (PLAN_per_plan_timezone).
 *
 * Cross-plan zone-group conflicts must compare REAL instants, not wall-clock
 * integers: the same wall-clock 14:00 in Europe/Warsaw and America/New_York is
 * two different real instants, and a Warsaw-14:00 / NewYork-08:00 pair (which
 * shares the real instant 12:00 UTC) must conflict.
 *
 * The trigger logic itself is covered by tests/test_time_tz.py (raw SQL spike).
 * These e2e tests exercise the integration path: the real /xhr/plan/apply
 * endpoint + book_overlap_insert trigger across two TZ-aware plans sharing a
 * zone_group, and the iCal feed's per-booking TZID + VTIMEZONE block.
 *
 * Booking timestamps are sent explicitly via apply (admin) so the wall-clock
 * times are deterministic — the slider-based UI flow can't pin exact wall times,
 * and the point here is the cross-TZ conflict rule, not the slider UX. apiApply
 * is the established conflict-assertion helper (see booking/zone-group.spec.ts).
 */
import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { getZoneSeats, apiApply, futureDayTs } from '../../helpers/booking';

/** A future wall-clock midnight (fake-UTC int) N days out. Storage is wall-clock,
 *  so this is just a day anchor; the plan TZ decides which real instant it is. */
const DAY = () => futureDayTs(2);
const H = (n: number) => n * 3600;

/** Set up two TZ-aware plans (Warsaw / New York) whose zones share a group. */
async function setupCrossTzPlans() {
  await querySql("UPDATE plan SET timezone = 'Europe/Warsaw' WHERE id = 1");
  await querySql("UPDATE plan SET timezone = 'America/New_York' WHERE id = 2");
  await querySql("UPDATE zone SET zone_group = 'crosstz' WHERE id IN (1, 2)");
}

test.describe('per-plan timezone', () => {

  test('same wall-clock in two TZs is NOT a conflict (different real instants)', async ({ page }) => {
    await logIn(page, ADMIN);
    await setupCrossTzPlans();
    await querySql("DELETE FROM book WHERE sid IN (SELECT id FROM seat WHERE zid IN (1,2))");

    const [zone1Seat] = await getZoneSeats(1);   // plan 1 (Warsaw)
    const [zone2Seat] = await getZoneSeats(2);    // plan 2 (New York)
    const day = DAY();

    // Warsaw 14:00-15:00 wall = UTC 12:00-13:00 (summer, CEST = UTC+2).
    const warsaw = await apiApply(page, {
      book: { sid: zone1Seat.id, dates: [{ fromTS: day + H(14), toTS: day + H(15) }] },
    });
    expect(warsaw.status()).toBe(200);
    expect((await warsaw.json()).msg).toBe('ok');

    // New York 14:00-15:00 wall = UTC 18:00-19:00 (summer, EDT = UTC-4).
    // Same wall-clock digits, different real instant → trigger must allow both.
    const nySameWall = await apiApply(page, {
      book: { sid: zone2Seat.id, dates: [{ fromTS: day + H(14), toTS: day + H(15) }] },
    });
    expect(nySameWall.status()).toBe(200);
    expect((await nySameWall.json()).msg).toBe('ok');
  });

  test('overlapping real instants across TZs ARE a conflict (exclusion_violation)', async ({ page }) => {
    await logIn(page, ADMIN);
    await setupCrossTzPlans();
    await querySql("DELETE FROM book WHERE sid IN (SELECT id FROM seat WHERE zid IN (1,2))");

    const [zone1Seat] = await getZoneSeats(1);
    const [zone2Seat] = await getZoneSeats(2);
    const day = DAY();

    // Warsaw 14:00-15:00 wall = UTC 12:00-13:00.
    const warsaw = await apiApply(page, {
      book: { sid: zone1Seat.id, dates: [{ fromTS: day + H(14), toTS: day + H(15) }] },
    });
    expect(warsaw.status()).toBe(200);

    // New York 08:00-09:00 wall = UTC 12:00-13:00 — same real instant → rejected.
    // This is the case wall-clock storage alone gets wrong: 14:00 != 08:00 as
    // integers, but they are the same instant across these two zones.
    const nyOverlap = await apiApply(page, {
      book: { sid: zone2Seat.id, dates: [{ fromTS: day + H(8), toTS: day + H(9) }] },
    });
    expect(nyOverlap.status()).toBe(400);
    expect((await nyOverlap.json()).code).toBe(109);  // "Overlapping time"
  });

  test('back-to-back real instants across TZs are allowed (touching, not overlapping)', async ({ page }) => {
    await logIn(page, ADMIN);
    await setupCrossTzPlans();
    await querySql("DELETE FROM book WHERE sid IN (SELECT id FROM seat WHERE zid IN (1,2))");

    const [zone1Seat] = await getZoneSeats(1);   // Warsaw
    const [zone2Seat] = await getZoneSeats(2);    // New York
    const day = DAY();

    // Warsaw 14:00-16:00 = UTC 12:00-14:00.
    const warsaw = await apiApply(page, {
      book: { sid: zone1Seat.id, dates: [{ fromTS: day + H(14), toTS: day + H(16) }] },
    });
    expect(warsaw.status()).toBe(200);

    // New York 10:00-14:00 = UTC 14:00-18:00 — meets the Warsaw booking exactly
    // at UTC 14:00 (half-open), so it must be ALLOWED, not rejected.
    const nyAdjacent = await apiApply(page, {
      book: { sid: zone2Seat.id, dates: [{ fromTS: day + H(10), toTS: day + H(14) }] },
    });
    expect(nyAdjacent.status()).toBe(200);
    expect((await nyAdjacent.json()).msg).toBe('ok');
  });

  test('one ungrouped zone spanning two TZ plans rejects a real-instant overlap', async ({ page }) => {
    // Build a single UNGROUPED zone (zone 1) holding seats on plans in two TZs:
    // relocate a New-York-plan (plan 2) seat into zone 1, alongside its Warsaw
    // (plan 1) seats. This exercises the trigger's `bu.zid = booking_zid` branch
    // across TZs — distinct from the zone_group branch the other tests hit.
    await logIn(page, ADMIN);
    await querySql("UPDATE plan SET timezone = 'Europe/Warsaw' WHERE id = 1");
    await querySql("UPDATE plan SET timezone = 'America/New_York' WHERE id = 2");
    await querySql("UPDATE zone SET zone_group = NULL WHERE id = 1");

    const warsawSeat = Number((await querySql(
      "SELECT id FROM seat WHERE pid = 1 AND zid = 1 ORDER BY id LIMIT 1")).rows[0].id);
    const nySeat = Number((await querySql(
      "SELECT id FROM seat WHERE pid = 2 AND zid = 2 ORDER BY id LIMIT 1")).rows[0].id);
    await querySql("UPDATE seat SET zid = 1 WHERE id = $1", [nySeat]);
    // Clear every booking now in zone 1 (incl. the relocated seat) so the result
    // can't depend on leftovers from earlier specs.
    await querySql("DELETE FROM book WHERE sid IN (SELECT id FROM seat WHERE zid = 1)");

    try {
      const day = DAY();
      // Warsaw 14:00-15:00 = UTC 12:00-13:00.
      const warsaw = await apiApply(page, {
        book: { sid: warsawSeat, dates: [{ fromTS: day + H(14), toTS: day + H(15) }] },
      });
      expect(warsaw.status()).toBe(200);

      // NY 08:00-09:00 = UTC 12:00-13:00 — same real instant, same (ungrouped)
      // zone, different seat/TZ → rejected by the zid branch.
      const nyOverlap = await apiApply(page, {
        book: { sid: nySeat, dates: [{ fromTS: day + H(8), toTS: day + H(9) }] },
      });
      expect(nyOverlap.status()).toBe(400);
      expect((await nyOverlap.json()).code).toBe(109);
    } finally {
      // Restore the relocated seat so the shared seed is unchanged for later specs.
      await querySql("DELETE FROM book WHERE sid IN ($1, $2)", [warsawSeat, nySeat]);
      await querySql("UPDATE seat SET zid = 2 WHERE id = $1", [nySeat]);
    }
  });

  test('iCal feed emits VTIMEZONE + per-booking TZID (not floating Z)', async ({ page }) => {
    // Plan 1 is Warsaw. Put a user1 booking at wall 14:00-15:00 on a plan-1 seat
    // and fetch the feed; the VEVENT must stamp the plan TZ, not float as UTC.
    await querySql("UPDATE plan SET timezone = 'Europe/Warsaw' WHERE id = 1");
    await querySql("DELETE FROM book WHERE login = 'user1'");
    const [zone1Seat] = await getZoneSeats(1);
    const day = DAY();
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', zone1Seat.id, day + H(14), day + H(15)],
    );

    // Enable iCal for user1 via the prefs API and read the token (the feed is
    // token-authenticated; no live session needed to fetch it).
    await logIn(page, USER1);
    await page.request.post('/xhr/calendar', {
      data: { ical_enabled: true, ensure_token: true },
      headers: { 'Content-Type': 'application/json' },
    });
    const prefs = await (await page.request.get('/xhr/calendar')).json();
    const token: string = prefs.ical_token;

    const resp = await page.request.get(`/calendar/user1/events.ics?t=${token}`);
    expect(resp.status()).toBe(200);
    const ics = await resp.text();

    // VTIMEZONE block with the plan's TZID, with well-formed observances.
    expect(ics).toContain('BEGIN:VTIMEZONE');
    expect(ics).toContain('TZID:Europe/Warsaw');
    expect(ics).toContain('TZOFFSETTO:');

    // The booking VEVENT stamps wall-clock time in the plan TZ via ;TZID (NOT a
    // floating/UTC ...Z form). 14:00 wall → T140000.
    expect(ics).toContain('DTSTART;TZID=Europe/Warsaw:');
    expect(ics).toMatch(/DTSTART;TZID=Europe\/Warsaw:\d{8}T140000/);
    expect(ics).not.toMatch(/DTSTART:\d{8}T\d{6}Z/);
  });

  test('iCal reminders are gridded + stamped per-zone TZ (not a user default TZ)', async ({ page }) => {
    // Plans 1 (Warsaw) and 2 (NY); user1 is reminded for both zones. A missing
    // -booking reminder for zone 1 must be stamped Europe/Warsaw, for zone 2
    // America/New_York — each gridded in its own office's wall-clock day.
    await querySql("UPDATE plan SET timezone = 'Europe/Warsaw' WHERE id = 1");
    await querySql("UPDATE plan SET timezone = 'America/New_York' WHERE id = 2");
    await querySql("DELETE FROM book WHERE login = 'user1'");

    await logIn(page, USER1);
    // ahead_days=1 fires a reminder the day before each empty zone-day.
    await page.request.post('/xhr/calendar', {
      data: { ical_enabled: true, ensure_token: true, reminder_weekdays: 127,
              reminder_ahead_days: 1, reminder_time: 22 * 3600,
              reminder_release_ahead_days: 0, reminder_zones: [1, 2] },
      headers: { 'Content-Type': 'application/json' },
    });
    const prefs = await (await page.request.get('/xhr/calendar')).json();
    const token: string = prefs.ical_token;

    const resp = await page.request.get(`/calendar/user1/events.ics?t=${token}&type=reminders`);
    expect(resp.status()).toBe(200);
    const ics = await resp.text();

    // Each zone's missing-booking reminder carries its OWN plan TZID.
    expect(ics).toMatch(/UID:missing-1-\d+@warp.*?DTSTART;TZID=Europe\/Warsaw:/s);
    expect(ics).toMatch(/UID:missing-2-\d+@warp.*?DTSTART;TZID=America\/New_York:/s);
    // VTIMEZONE blocks for both zones.
    expect(ics).toContain('TZID:Europe/Warsaw');
    expect(ics).toContain('TZID:America/New_York');
  });
});
