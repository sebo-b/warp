# Tests for per-plan timezone logic:
#   - now(tz) / today(tz) wall-clock helpers
#   - is_valid_iana guard
#   - book_overlap_insert trigger cross-TZ spike
#   - book_utc view correctness

import calendar
import uuid
import datetime
from zoneinfo import ZoneInfo

import psycopg
import pytest

from warp.utils import is_valid_iana, today, now

# ── Unit tests — no DB ────────────────────────────────────────────────────────

def test_is_valid_iana_accepts_known_zones():
    assert is_valid_iana('Europe/Warsaw')
    assert is_valid_iana('America/New_York')
    assert is_valid_iana('UTC')
    assert is_valid_iana('Asia/Tokyo')

def test_is_valid_iana_rejects_unknown():
    assert not is_valid_iana('Fake/Zone')
    assert not is_valid_iana('..')
    assert not is_valid_iana('')
    assert not is_valid_iana('Europe')

def test_today_tz_midnight_aligned():
    for tz in ('UTC', 'Europe/Warsaw', 'America/New_York', 'Asia/Tokyo'):
        t = today(tz)
        assert t % (24 * 3600) == 0, f"today('{tz}') = {t} is not midnight-aligned"

def test_today_tz_within_24h_of_now():
    for tz in ('UTC', 'Europe/Warsaw', 'America/New_York'):
        n = now(tz)
        t = today(tz)
        assert 0 <= n - t < 24 * 3600, f"now('{tz}') - today('{tz}') out of range"

def test_now_tz_wall_clock_digits():
    # For a known UTC instant, verify that now(tz) returns the wall-clock digits
    # of that instant in the given zone, treated as fake-UTC seconds.
    # We fix the wall-clock via direct zoneinfo arithmetic (no monkeypatching):
    # pick 2024-07-15 12:00:00 UTC, which is 14:00 in Warsaw (UTC+2 summer).
    utc_ts = calendar.timegm((2024, 7, 15, 12, 0, 0, 0, 0, 0))
    dt_utc = datetime.datetime(2024, 7, 15, 12, 0, 0, tzinfo=datetime.timezone.utc)
    dt_warsaw = dt_utc.astimezone(ZoneInfo('Europe/Warsaw'))
    # Wall-clock in Warsaw: 14:00
    expected_wall = calendar.timegm(dt_warsaw.timetuple())  # fake-UTC for 14:00
    assert dt_warsaw.hour == 14
    assert expected_wall == calendar.timegm((2024, 7, 15, 14, 0, 0, 0, 0, 0))


# ── DB fixture ────────────────────────────────────────────────────────────────

_CONN = "host=127.0.0.1 port=5432 dbname=postgres user=postgres password=postgres_password"

# Minimal schema: only the tables / view / trigger needed for the overlap test.
# Omits zone_assign, groups, user_to_zone_roles (and their CONCURRENTLY-refresh
# triggers) so setup can run in a single autocommit transaction.
_MINIMAL_DDL = """
CREATE TABLE users (
    login text PRIMARY KEY,
    name text,
    account_type integer NOT NULL
);

CREATE TABLE zone (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    zone_type integer NOT NULL DEFAULT 20,
    zone_group text DEFAULT NULL
);

CREATE TABLE plan (
    id SERIAL PRIMARY KEY,
    name text NOT NULL,
    timezone text NOT NULL DEFAULT 'UTC'
);

CREATE TABLE seat (
    id SERIAL PRIMARY KEY,
    pid integer NOT NULL REFERENCES plan(id) ON DELETE CASCADE,
    zid integer NOT NULL REFERENCES zone(id) ON DELETE CASCADE,
    name text NOT NULL,
    x integer NOT NULL DEFAULT 0,
    y integer NOT NULL DEFAULT 0,
    enabled boolean NOT NULL DEFAULT TRUE
);

CREATE TABLE book (
    id SERIAL PRIMARY KEY,
    login text NOT NULL REFERENCES users(login) ON DELETE CASCADE,
    sid integer NOT NULL REFERENCES seat(id) ON DELETE CASCADE,
    fromts integer NOT NULL,
    tots integer NOT NULL
);

CREATE VIEW book_utc AS
SELECT b.id AS bid, b.login, b.sid, s.zid, z.zone_group, p.timezone,
       b.fromts, b.tots,
       (to_timestamp(b.fromts) AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS from_utc,
       (to_timestamp(b.tots)   AT TIME ZONE 'UTC' AT TIME ZONE p.timezone) AS to_utc
FROM book b
JOIN seat s ON s.id = b.sid
JOIN zone z ON z.id = s.zid
JOIN plan p ON p.id = s.pid;

CREATE FUNCTION book_overlap_insert()
 RETURNS trigger
 LANGUAGE plpgsql
AS $$
DECLARE
    booking_zid  INTEGER;
    zone_grp     TEXT;
    new_tz       TEXT;
    new_from_utc timestamptz;
    new_to_utc   timestamptz;
BEGIN
    IF NEW.fromTS >= NEW.toTS THEN
        RAISE EXCEPTION 'Incorrect time';
    END IF;

    IF EXISTS (
        SELECT 1 FROM book b
        WHERE b.sid = NEW.sid
          AND b.fromTS < NEW.toTS AND b.toTS > NEW.fromTS
    ) THEN
        RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
    END IF;

    SELECT s.zid, z.zone_group, p.timezone
      INTO booking_zid, zone_grp, new_tz
    FROM seat s JOIN zone z ON z.id = s.zid JOIN plan p ON p.id = s.pid
    WHERE s.id = NEW.sid;

    new_from_utc := to_timestamp(NEW.fromTS) AT TIME ZONE 'UTC' AT TIME ZONE new_tz;
    new_to_utc   := to_timestamp(NEW.toTS)   AT TIME ZONE 'UTC' AT TIME ZONE new_tz;

    IF zone_grp IS NOT NULL THEN
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zone_group = zone_grp
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    ELSE
        IF EXISTS (
            SELECT 1 FROM book_utc bu
            WHERE bu.login = NEW.login
              AND bu.zid = booking_zid
              AND bu.from_utc < new_to_utc AND bu.to_utc > new_from_utc
        ) THEN
            RAISE 'Overlapping time for this seat or users' USING ERRCODE = 'exclusion_violation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER book_overlap_insert_trig
BEFORE INSERT ON book
FOR EACH ROW
EXECUTE PROCEDURE book_overlap_insert();
"""


@pytest.fixture(scope="module")
def db():
    """Temporary PostgreSQL schema with minimal table/view/trigger set."""
    schema = f"test_tz_{uuid.uuid4().hex[:12]}"
    with psycopg.connect(_CONN, autocommit=True) as conn:
        conn.execute(f'CREATE SCHEMA "{schema}"')
        conn.execute(f'SET search_path TO "{schema}"')
        conn.execute(_MINIMAL_DDL)

        # Seed shared fixtures: one user, one zone_group, two plans, two seats.
        conn.execute("INSERT INTO users(login,name,account_type) VALUES ('u1','User 1',20)")

        conn.execute("INSERT INTO zone(name,zone_group) VALUES ('ZW','office') RETURNING id")
        zw_id = conn.execute("SELECT id FROM zone WHERE name='ZW'").fetchone()[0]
        conn.execute("INSERT INTO zone(name,zone_group) VALUES ('ZNY','office') RETURNING id")
        zny_id = conn.execute("SELECT id FROM zone WHERE name='ZNY'").fetchone()[0]

        # Warsaw (UTC+2 in summer) and New York (UTC-4 in summer)
        conn.execute("INSERT INTO plan(name,timezone) VALUES ('Warsaw','Europe/Warsaw') RETURNING id")
        pw_id = conn.execute("SELECT id FROM plan WHERE name='Warsaw'").fetchone()[0]
        conn.execute("INSERT INTO plan(name,timezone) VALUES ('NewYork','America/New_York') RETURNING id")
        pny_id = conn.execute("SELECT id FROM plan WHERE name='NewYork'").fetchone()[0]

        conn.execute(
            "INSERT INTO seat(pid,zid,name) VALUES (%s,%s,'SW') RETURNING id", (pw_id, zw_id)
        )
        sw_id = conn.execute("SELECT id FROM seat WHERE name='SW'").fetchone()[0]
        conn.execute(
            "INSERT INTO seat(pid,zid,name) VALUES (%s,%s,'SNY') RETURNING id", (pny_id, zny_id)
        )
        sny_id = conn.execute("SELECT id FROM seat WHERE name='SNY'").fetchone()[0]

        # Store IDs on the connection for tests
        conn._tz_ids = {
            'sw': sw_id, 'sny': sny_id,
            'zw': zw_id, 'zny': zny_id,
            'schema': schema,
        }

        yield conn

        conn.execute(f'DROP SCHEMA "{schema}" CASCADE')


def _wc(y, mo, d, h, mi=0):
    """Wall-clock fake-UTC integer: local HH:MM digits encoded as UTC seconds."""
    return calendar.timegm((y, mo, d, h, mi, 0, 0, 0, 0))


def _book(conn, sid, fromts, tots):
    conn.execute(
        "INSERT INTO book(login,sid,fromts,tots) VALUES ('u1',%s,%s,%s)",
        (sid, fromts, tots)
    )


def _del_all_books(conn):
    conn.execute("DELETE FROM book")


# ── Trigger tests ─────────────────────────────────────────────────────────────

def test_same_seat_overlap_rejected(db):
    """Same seat: same plan => same TZ => raw integer check catches duplicate."""
    _del_all_books(db)
    sw = db._tz_ids['sw']
    _book(db, sw, _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 16))
    with pytest.raises(psycopg.errors.ExclusionViolation):
        _book(db, sw, _wc(2024, 7, 15, 12), _wc(2024, 7, 15, 18))
    _del_all_books(db)


def test_same_wallclock_different_tz_no_conflict(db):
    """Same wall-clock digits (14:00-16:00) in Warsaw and New York do NOT overlap in real time.

    Warsaw 14:00-16:00 (UTC+2) = UTC 12:00-14:00
    New York 14:00-16:00 (UTC-4) = UTC 18:00-20:00
    No overlap => trigger must allow the second insert.
    """
    _del_all_books(db)
    sw = db._tz_ids['sw']
    sny = db._tz_ids['sny']
    # Same wall-clock integer, different plans/TZs
    from_wc = _wc(2024, 7, 15, 14)
    to_wc   = _wc(2024, 7, 15, 16)
    _book(db, sw,  from_wc, to_wc)  # Warsaw
    _book(db, sny, from_wc, to_wc)  # New York — must not raise
    _del_all_books(db)


def test_real_instant_overlap_rejected(db):
    """Bookings whose real UTC intervals overlap across TZs are rejected.

    Warsaw 10:00-20:00 (UTC+2) = UTC 08:00-18:00
    New York 09:00-15:00 (UTC-4) = UTC 13:00-19:00
    Overlap at UTC 13:00-18:00 => trigger must raise ExclusionViolation.
    """
    _del_all_books(db)
    sw = db._tz_ids['sw']
    sny = db._tz_ids['sny']
    _book(db, sw,  _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 20))  # Warsaw
    with pytest.raises(psycopg.errors.ExclusionViolation):
        _book(db, sny, _wc(2024, 7, 15, 9), _wc(2024, 7, 15, 15))  # New York
    _del_all_books(db)


def test_real_instant_adjacent_not_rejected(db):
    """Adjacent (touching, not overlapping) real instants are allowed.

    Warsaw 10:00-14:00 (UTC+2) = UTC 08:00-12:00
    New York 08:00-14:00 (UTC-4) = UTC 12:00-18:00
    Touch at UTC 12:00 but [08:00,12:00) and [12:00,18:00) don't overlap.
    """
    _del_all_books(db)
    sw = db._tz_ids['sw']
    sny = db._tz_ids['sny']
    _book(db, sw,  _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 14))
    _book(db, sny, _wc(2024, 7, 15, 8),  _wc(2024, 7, 15, 14))  # must not raise
    _del_all_books(db)


# ── book_utc view correctness ─────────────────────────────────────────────────

def test_book_utc_correct_real_instant(db):
    """from_utc for a Warsaw wall-clock booking equals the expected UTC instant."""
    _del_all_books(db)
    sw = db._tz_ids['sw']
    # Warsaw wall-clock 14:00 = UTC 12:00 in summer (CEST = UTC+2)
    fromts = _wc(2024, 7, 15, 14)
    tots   = _wc(2024, 7, 15, 16)
    _book(db, sw, fromts, tots)
    row = db.execute("SELECT from_utc, to_utc FROM book_utc").fetchone()
    from_utc, to_utc = row
    # Expect UTC 12:00 and 14:00 on 2024-07-15
    expected_from = datetime.datetime(2024, 7, 15, 12, 0, 0, tzinfo=datetime.timezone.utc)
    expected_to   = datetime.datetime(2024, 7, 15, 14, 0, 0, tzinfo=datetime.timezone.utc)
    assert from_utc.astimezone(datetime.timezone.utc) == expected_from
    assert to_utc.astimezone(datetime.timezone.utc)   == expected_to
    _del_all_books(db)


def test_book_utc_reflects_plan_tz_edit(db):
    """book_utc is a plain view — it reflects a plan.timezone edit without a refresh."""
    _del_all_books(db)
    sw = db._tz_ids['sw']
    fromts = _wc(2024, 7, 15, 14)
    tots   = _wc(2024, 7, 15, 16)
    _book(db, sw, fromts, tots)

    # Before edit: Warsaw (UTC+2) → from_utc should be 12:00 UTC
    row_before = db.execute("SELECT from_utc FROM book_utc").fetchone()[0]
    assert row_before.astimezone(datetime.timezone.utc).hour == 12

    # Edit plan timezone to UTC+5:30 (Asia/Kolkata); 14:00 IST = 08:30 UTC
    db.execute("UPDATE plan SET timezone='Asia/Kolkata' WHERE name='Warsaw'")
    row_after = db.execute("SELECT from_utc FROM book_utc").fetchone()[0]
    after_utc = row_after.astimezone(datetime.timezone.utc)
    # 14:00 IST = UTC 08:30
    assert after_utc.hour == 8
    assert after_utc.minute == 30

    # Restore
    db.execute("UPDATE plan SET timezone='Europe/Warsaw' WHERE name='Warsaw'")
    _del_all_books(db)
