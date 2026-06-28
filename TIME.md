# WARP time handling — reference

> **Purpose.** This is the canonical reference for how WARP represents, stores,
> and computes time. Read this before touching anything timestamp-related.

---

## 1. The design, in one paragraph

WARP uses **wall-clock ("fake-UTC") storage**. Every timestamp is a plain
`integer` column holding `timegm(localtime_in_plan_tz())` — wall-clock digits
treated as UTC. The booking `14:00–16:00 Europe/Warsaw` is stored as
`timegm((…, 14, 0, 0))`, exactly the same digits as `14:00–16:00 UTC`. This
gives the "airline ticket" guarantee: a desk booked for 14:00 Warsaw time is
always displayed as 14:00, unaffected by DST or UTC offset.

Each **plan** carries an IANA `timezone` column (e.g. `Europe/Warsaw`). A
`book_utc` SQL view re-interprets each booking's wall-clock digits in its
plan's timezone to produce real UTC instants (`from_utc`, `to_utc` as
`timestamptz`). Cross-TZ conflict detection and iCal feeds use those real
instants; everything that stays within a single plan's wall-clock continues
to use the fake-UTC integers directly.

`DEFAULT_PLAN_TIMEZONE` (`WARP_DEFAULT_PLAN_TIMEZONE`) sets the default for
new plans and anchors the iCal reminder feed. `TIMEZONE` is a deprecated alias.

New plans default to UTC; an admin sets the office TZ at plan creation. There
is no global default-TZ config (`DEFAULT_PLAN_TIMEZONE`/`TIMEZONE` removed).

> Throughout the codebase this scale is called **"fake-UTC"**: an integer that
> *looks* like a UNIX-UTC second but is actually local wall-clock treated as UTC.

---

## 2. The core functions (`warp/utils.py`)

These four functions are the **only** sanctioned way to get "now" or "today".
Everything else composes on top of them.

```python
def now(tz=None):
    """Wall-clock seconds since 1970-01-01 (fake-UTC) for the given IANA tz."""
    if tz:
        return timegm(datetime.now(ZoneInfo(tz)).timetuple()) + _debug_time_offset
    return timegm(localtime()) + _debug_time_offset

def today(tz=None):
    """now(tz) floored to the plan's local midnight (fake-UTC)."""
    n = now(tz)
    return n - n % (24*3600)
```

- `_debug_time_offset` — debug-only virtual clock shift, set via
  `POST /debug/set_time_offset`. **Zero in production** (module-level state;
  not safe across uWSGI workers — see §8).
- `getTimeRange(extended=False, tz=None)` — returns `{fromTS, toTS}` using
  `today(tz)` as the seed. The `toTS` boundary uses `gmtime()` on the fake-UTC
  integer to find `tm_wday`, then anchors to "last weekday of the current week
  + N weeks". This is the **booking window** every enforce-time check compares
  against.
- `is_valid_iana(name)` — validates an IANA timezone name via `zoneinfo`;
  guards against path-traversal strings like `'..'`.
- `getCalendarGrid(today_ts, target_ts)` — pure-data calendar blob (whole
  months, padded rectangles) driving the plan-panel calendar. **Backend-computed
  by design (R1/R9)** so the frontend never calls `new Date(ts)`. Cells carry a
  `timestamp` in the same fake-UTC scale, a `selectable` flag
  (`today_midnight ≤ day ≤ window_end` and weekday not in
  `OMITTED_WEEKDAYS`), and `isToday`. Range/selectable/week-start rules all live
  here, once.
- `formatTimestamp` / `formatTimespan` — `strftime` over `gmtime(ts)` (i.e.
  format the fake-UTC integer as a wall-clock string). Used by iCal action pages
  and bookings JSON.

### The "today" boundary (critical invariant)

`today(plan_tz)` returns the plan's local midnight as a fake-UTC integer.
Every caller that needs the plan's notion of "today" must pass `plan_tz`:
- `getTimeRange(tz=plan_tz)` — booking window for that plan.
- `apply`'s code-103 window check, `runAutoBook`'s `withinWindow`, and
  `getCalendarGrid` all use `today(tz=plan_tz)`.
- The default (no `tz`) falls back to `localtime()`, which is correct only
  when server OS TZ == plan TZ (single-office deployments).

---

## 3. Storage schema (`warp/sql/schema.sql`, migrations)

Time columns:

| Table | Columns | Notes |
|:---|:---|:---|
| `book` | `fromts integer`, `tots integer` | booking span (fake-UTC) |
| `calendar_cache` | `day integer`, `generated_at integer` | iCal cache key + inception |
| `plan` | `timezone text NOT NULL DEFAULT 'UTC'` | IANA tz for wall-clock interpretation |

### `book_utc` view

Converts each booking's wall-clock fake-UTC integers to real UTC instants:

```sql
to_timestamp(b.fromts) AT TIME ZONE 'UTC' AT TIME ZONE plan.timezone
```

Step 1: fake-UTC integer → naive wall-clock datetime (via `AT TIME ZONE 'UTC'`).
Step 2: wall-clock re-interpreted in plan TZ → real `timestamptz`.

Exposes `from_utc`, `to_utc` (`timestamptz`) plus `sid`, `zid`, `bid`,
`login`, `fromts`, `tots`, `timezone`. Used by the overlap trigger and
`getSeats` conflict translation.

### `book_overlap_insert` trigger (the overlap rule)

A `BEFORE INSERT` PL/pgSQL trigger enforces exclusivity:

1. Reject if `fromts >= tots`.
2. **Same seat** (always raw integer): `b.fromts < NEW.tots AND b.tots > NEW.fromts`.
3. **Zone-group** (non-NULL `zone_group`): reject if the same user has any booking
   in any zone of that group whose **real UTC interval** (`book_utc.from_utc …
   to_utc`) overlaps the **real UTC interval** of the new booking.
4. **Ungrouped zone** (no zone_group): same as branch 3 but scoped to a single
   zone, also via `book_utc`.

Branches 3–4 use `book_utc` so that `Warsaw 14:00–16:00` and `NYC 14:00–16:00`
(non-overlapping in real UTC) do **not** conflict, while `Warsaw 10:00–20:00`
and `NYC 09:00–15:00` (real UTC overlap) **do** conflict.

### `days_in_advance` (the "release" mechanic)

`seat_assign.days_in_advance integer` (nullable). This is **not** a scheduler
and **not** auto-cancellation. It is a booking-window cutoff: a seat with
`dia=3` cannot be *booked* more than 3 days ahead. The moment "today" crosses
`today + (dia+1)*86400`, the seat becomes bookable by others. Enforced in
`apply` (code 110) and `runAutoBook.withinWindow` / `available_from_ts`.

### `reminder_release_ahead_days`

`user_prefs.reminder_release_ahead_days integer`. A **reminder** about the
above window opening, surfaced as an iCal VEVENT. It is *purely advisory*; no
DB mutation, no background job. Sometimes confused with auto-release; it is
not.

---

## 4. Per-feature time usage

### `warp/xhr/plan.py` (booking + autobook — the heaviest time user)
- Resolves `plan_tz = plan['timezone'] or None` for every operation.
- `getSeats`: uses `utils.getTimeRange(tz=plan_tz)`; conflict bookings from
  other plans are translated to the open plan's wall-clock scale via
  `EXTRACT(EPOCH FROM (bu.from_utc AT TIME ZONE open_tz AT TIME ZONE 'UTC'))`.
- `apply`: code-103 window check uses `getTimeRange(tz=plan_tz)`; `today(plan_tz)`
  for `days_in_advance` cutoff (code 110).
- `runAutoBook`: `today = utils.today(tz=plan_tz)`.

### `warp/ical.py` (iCal feed + HMAC action endpoints)
- `ical_feed`: anchors `today_ts`/`now_ts` on **UTC** (the feed/cache clock).
- `_generate_bookings_vevents`: joins `Plan.timezone` per booking; emits
  `DTSTART;TZID=<plan_tz>:YYYYMMDDTHHMMSS` (wall-clock in plan TZ).
- `_generate_reminders_vevents`: **per reminder zone** — each zone is gridded
  in its own plan TZ ("day before in NY is day before in NY"); emits
  `DTSTART;TZID=<zone_plan_tz>:…`.
- `_vtimezone_block(tz, since, until)`: emits RFC 5545 VTIMEZONE with explicit
  STANDARD/DAYLIGHT observances (minute-precise, no RRULE guessing).
- `_get_or_cache`: generates VTIMEZONE blocks for all distinct TZs in the feed,
  prepends them before VEVENTs in the cached ICS.
- `book_seat` (iCal action): past-booking guard uses `today(plan_tz)` (resolved
  from the zone's plan).
- `_ts_to_ical_dt(ts, tz)`: `gmtime(ts)` gives back wall-clock digits (fake-UTC
  property); when `tz` given, emits without `Z` (for `TZID=` pairing).

### `warp/xhr/bookings.py` (report + list)
- Excel export: cell serial `(ts / 86400) + 25569` is correct per-row because
  `ts` is already the booking's plan-TZ wall-clock; no conversion needed.
  Includes a **Timezone** column (`plan.timezone`) per row so the wall-clock is
  unambiguous across offices. Sorted by `from_utc` (real UTC instant) for
  chronological multi-TZ output.

### `warp/view.py`
- `plan(pid)`: uses `plan_tz = plan['timezone'] or None`; `now_ts = utils.now(tz=plan_tz)`,
  `today_ts = utils.today(tz=plan_tz)`. Calendar grid and template receive the
  plan-TZ today.

### `warp/xhr/users.py`
- `delete`: guards "has past bookings" with `Book.fromts < utils.today()`.

### `warp/debug.py` (debug only)
- `/debug/time`, `/debug/set_time_offset`: read/shift `_debug_time_offset`.

### `warp/xhr/prefs.py`, `warp/xhr/calendar.py`
- Store/return `default_time_from/to` (seconds-of-day, in the plan's wall-clock)
  and reminder settings. No `today()`/`now()` use.

---

## 5. The multi-zone / cross-plan / zone-group conflict model

This is the part the per-plan-TZ change has to get right. Two layers overlap:
the **DB trigger** (§3) enforces hard exclusivity; the **frontend** adds UX
feedback. The model is **plan-scoped by display, group-scoped by exclusivity**.

### Entities
- A **plan** = a floor-map image + the seats placed on it. One plan can contain
  seats from **several zones** (an open zone + a restricted zone on the same
  map). `seat.pid → plan.id`, `seat.zid → zone.id`.
- A **zone** = access-control group of seats. Has `zone_type` and optional
  `zone_group`.
- `zone_group` is **a free-text label spanning zones**, even across different
  plans. Two zones (say "Floor 3 desks" and "Parking garage") with the same
  `zone_group` enforce "one user, one seat at a time" across both.

### What `getSeats` (plan.py) ships to the frontend
For the plan the user opened, plus **conflict seats** on *other* plans/zones that
share a `zone_group`. Concretely the response carries:
- `zones: {zid: name}`, `zoneGroups: {zid: zone_group|null}` — the client uses
  `zoneGroups` to scope "can I also book here?" per-zone-group (matching the
  trigger's per-group / else per-single-zone branch), **not** per-whole-plan.
- `seats[sid]` for every seat in an accessible zone on this plan, each with
  `book: [{bid, login, fromTS, toTS}]`.
- **Conflict seats** (`book` only, no seat metadata) for the current user's
  bookings in any zone that shares a group with a zone on this plan — so the UI
  can flag a seat `CAN_REBOOK` instead of `CAN_BOOK` when the user already holds
  a conflicting booking elsewhere.

### Frontend (`js/views/modules/seat.js`, `js/views/plan.js`)
- **R1 invariant (discipline):** "no `new Date(ts)`, no
  `getTimezoneOffset()`, no `toISOString()` to derive a *day identity*." The
  calendar grid (`calendarGrid.js`) only lays out backend cells in wire order;
  `getSelectedDates()` builds `{fromTS: ts+fromOff, toTS: ts+toOff}` by pure
  integer addition over the backend's `timestamp` cells + slider offsets. So the
  TZ the *server* used is the TZ the booking is stored in; the browser TZ never
  enters the booking path.
- `_bookingsIterator` is an O(m+n) merge of the (sorted) `selectedDates` and
  the (sorted) `book` list, intersecting by integer overlap
  (`book.fromTS < date.toTS && book.toTS > date.fromTS`).
- `getMyConflictingBookings(forSeat)` scopes my bookings to
  `forSeat.exclusivityKey` (the zone-group, or the single zone when ungrouped) —
  mirroring the DB trigger, in the client.
- Seat states (`CAN_BOOK`/`CAN_REBOOK`/`CAN_DELETE`/`CAN_CHANGE`/`ASSIGNED`/…)
  are computed from the intersection of my selections, the seat's bookings, and
  the `days_in_advance` cutoff, the latter **server-anchored**:
  `cutoffTs = window.warpGlobals.today + (bestDays+1)*24*3600` (the `today`
  value is injected by the template, in the server's localtime today).

### The two known frontend TZ leaks (pre-existing, outside R1 discipline)
Both call `new Date(ts*1000)` / `.toISOString()` to *format* (not to derive day
identity), so they don't break booking correctness but do display in the
**browser's** TZ when "today"/the booking's plan TZ differs from the browser:
1. `bookings.js` `tsFormatter` / `dateFilterEditor` — the My-Bookings / report
   page. `new Date(parseInt(data)*1000).toISOString()`, and a client-computed
   `todayTS = new Date() - getTimezoneOffset()*60` for the default filter range.
2. `seat.js::_formatDatePair` — formats a booking's `fromTS/toTS` with
   `new Date(b.fromTS*1000).toISOString()` for action-menu labels and
   conflict lists.

**This is the crux for per-plan-TZ:** today everything assumes one TZ, so the
browser-TZ leak is invisible. Once plans have different TZs, a plan opened in a
browser in a *different* TZ than the plan must render the plan's wall-clock,
not the browser's — which means the backend must supply the formatted wall-clock
strings (R9-style "pure data, no strings" can't survive a TZ mismatch if the
client formats with its own TZ). See PLAN §4.

### Why this model becomes TZ-sensitive
- **Same plan, several zones** → one TZ (plan's TZ). Fine; conflict math is
  single-TZ exactly as today.
- **`zone_group` spanning multiple plans** → potentially **multiple TZs**. The
  overlap rule (`fromts < tots && tots > fromts`) compares integers directly;
  integers from different fake-UTC scales are **not comparable**. Two bookings
  at "14:00 plan-A-TZ" and "14:00 plan-B-TZ" are different real instants but
  compare as equal fake-UTC integers → false conflict, or false non-conflict.
  This is the hard part the plan must resolve (convert to a real instant, or
  store a canonical UTC instant alongside the wall-clock).

---

## 6. iCal output (`warp/config.py`, `warp/ical.py`)

- `DefaultSettings` no longer carries a default-TZ setting —
  `DEFAULT_PLAN_TIMEZONE`/`TIMEZONE` were removed (per-plan TZ supersedes them;
  reminders are per-zone, not user-level). New plans default to UTC.
- Each booking VEVENT carries `DTSTART;TZID=<plan_tz>:YYYYMMDDTHHMMSS`.
  The feed includes one `VTIMEZONE` block per distinct plan TZ encountered,
  with explicit STANDARD/DAYLIGHT observances (minute-precise transitions via
  binary search in `zoneinfo`). RFC 5545 §3.6.5 compliance — no RRULE guessing.
- Reminders are gridded **per reminder zone**, in that zone's own plan TZ, so
  the horizon day is each office's wall-clock day — a user reminded about the
  NY office sees NY-day grid + NY `TZID`.

### Calendar cache
`calendar_cache` is `UNLOGGED`, `PRIMARY KEY (login, type)`, upserted via
`on_conflict` → **≤2 rows per login, bounded** (not unbounded growth). `day` and
`generated_at` are fake-UTC integers from `utils.today()/now()`; the only reader
compares `row['day'] == today_ts` in the same scale — **internally consistent,
no staleness**. Deleted users cascade. Cache rows are *language-sensitive*
(`/debug/set_language` truncates the table) and are invalidated on every
booking/assign/prefs/calendar write via `invalidate_calendar_cache(logins)`.

---

## 7. Deployment / containers

- Both `Dockerfile` (prod) and `Dockerfile_debug` install `tzdata` (Alpine's
  musl needs it for Python `zoneinfo` and `localtime()` to resolve IANA names).
- `ENV TZ=UTC` is set as a safe default in both images; operators override it
  with `TZ=Europe/Warsaw` in their compose/quadlet environment. The `TZ` env
  var pins the container OS clock (used by the migration's
  `current_setting('TIMEZONE')` backfill); it does not set any app config
  now that `DEFAULT_PLAN_TIMEZONE` is removed.
- `compose.yaml` documents `TZ` with a commented example.
- `warp/__init__.py` registers `debug.bp` only when `app.debug` (dev / e2e).
- e2e harness: `e2e/fixtures.ts` zeroes `/debug/set_time_offset` before every
  test and drives the server clock through that endpoint. The whole e2e suite
  is single-worker because tests share one DB.

---

## 8. Known caveats

1. **`_debug_time_offset` is process-global state.** If e2e ever runs against a
   multi-worker prod image, virtual-time tests will race. E2e uses the
   single-process debug image, so it is fine today.
2. **DST — nonexistent/ambiguous-hour edge.** `today(tz)` floors to a 24h
   boundary; a DST day is 23/25 h. A reminder reminder_time falling in the
   skipped hour (spring-forward) will be off by 1 h; a booking whose
   `fromts` falls in the repeated hour (fall-back) is ambiguous but stored
   unambiguously (wall-clock digit is unique). The iCal cache regenerates
   daily, so the DST drift in the 30-day horizon is self-correcting within
   24 h. Accepted limitation.
3. **`readlink('/etc/localtime')`** is no longer consulted by the app (the
   `_detect_system_tz()` auto-detect path was removed with
   `DEFAULT_PLAN_TIMEZONE`); only the migration's PG-server-TZ backfill reads
   `current_setting('TIMEZONE')`.
4. **`calendar_cache` has no GC of stale-by-day rows**, but the PK upsert
   bounds it to ≤2 rows/login. Not a real concern.
5. **Cross-plan conflict display** (the `getSeats` UX feedback, not the trigger)
   translates conflict bookings from foreign plans to the open plan's wall-clock
   scale. A plan whose TZ is unknown to `book_utc` (e.g. stored empty) silently
   falls back to UTC for the translation.

---

## 9. Glossary of terms used above

- **fake-UTC**: a POSIX-epoch-second integer that is actually plan-local
  wall-clock treated as UTC. The unit of `book.fromts/tots`, `today(tz)`, `now(tz)`.
- **plan**: a floor-map + its seats + its IANA `timezone`.
- **zone**: access-control group of seats; lives on a plan.
- **zone_group**: an optional label spanning zones (across plans) enforcing
  mutual-exclusivity of bookings per user.
- **book_utc** (view): derives real UTC instants from wall-clock + plan TZ.
- **days_in_advance** (`seat_assign`): a booking-window cutoff, not a scheduler.
- **Per-plan TZ**: each plan carries an IANA `timezone` (default UTC, set at
  plan creation). There is no global default-TZ config.
- **R1 / R9**: the frontend disciplines "no `new Date(ts)` for day identity"
  (R1) and "pure data, no localized strings" (R9) established by
  `PLAN_calendar_refactor.md`.

---

*Update this file when the time implementation changes.*
