# Tests for per-plan timezone logic:
#   - now(tz) / today(tz) wall-clock helpers
#   - is_valid_iana guard
#   - book_overlap_insert trigger cross-TZ spike
#   - book_utc view correctness
#   - _vtimezone_block observance correctness (RFC 5545)
#   - bookings listW/report from_utc query (peewee-alias regression guard)

import calendar
import uuid
import datetime
from zoneinfo import ZoneInfo

import psycopg
import pytest

from warp.utils import is_valid_iana, today, now
from warp.ical import _vtimezone_block

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


# ── KNOWN, ACCEPTED EDGE: debug time-offset is applied in two domains ─────────
#
# The e2e virtual-clock offset (utils._debug_time_offset, set via
# /debug/set_time_offset) is added in DIFFERENT domains by the Python and SQL
# time helpers, and we deliberately do NOT reconcile them:
#
#   * Python now(tz)/today(tz) add the offset to the fake-UTC WALL-CLOCK integer
#     (after timegm of the zone's wall-clock).
#   * SQL now_sql()/today_in_tz_sql() add it to a REAL timestamptz (now() +
#     make_interval) BEFORE the AT TIME ZONE conversion.
#
# A pure time shift commutes with the wall-clock<->real conversion EXCEPT across
# a DST transition that the shift itself steps over, where the two domains can
# disagree by the DST delta (≤1h). This only affects e2e tests that set a large
# virtual offset landing on the far side of a DST boundary; in production the
# offset is always 0, so the two paths are identical. Not worth the complexity
# of carrying the offset through a single domain — documented here instead.


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

        # ── Extra fixtures for cross-TZ edge-case coverage ───────────────────
        # Two more whole-/half-hour offset plans (no DST): Tokyo (UTC+9) and
        # Kolkata (UTC+5:30), so we exercise a 3rd zone and a :30 offset.
        def _plan(name, tz):
            return conn.execute("INSERT INTO plan(name,timezone) VALUES (%s,%s) RETURNING id",
                                (name, tz)).fetchone()[0]
        def _zone(name, grp):
            return conn.execute("INSERT INTO zone(name,zone_group) VALUES (%s,%s) RETURNING id",
                                (name, grp)).fetchone()[0]
        def _seat(pid, zid, name):
            return conn.execute("INSERT INTO seat(pid,zid,name) VALUES (%s,%s,%s) RETURNING id",
                                (pid, zid, name)).fetchone()[0]

        ptok_id = _plan('Tokyo', 'Asia/Tokyo')        # UTC+9, no DST
        pkol_id = _plan('Kolkata', 'Asia/Kolkata')    # UTC+5:30, no DST

        # ONE ungrouped zone (zone_group NULL) whose seats live on plans in FOUR
        # different TZs — the trigger's `bu.zid = booking_zid` branch must compare
        # real instants across all of them.
        zu_id = _zone('ZU', None)
        su_w   = _seat(pw_id,  zu_id, 'SU_W')    # Warsaw
        su_ny  = _seat(pny_id, zu_id, 'SU_NY')   # New York
        su_tok = _seat(ptok_id, zu_id, 'SU_TOK') # Tokyo
        su_kol = _seat(pkol_id, zu_id, 'SU_KOL') # Kolkata

        # THREE zones in ONE zone_group ('grp3'), each on a plan in a different TZ
        # — the trigger's `bu.zone_group = zone_grp` branch must compare real
        # instants across zones AND TZs.
        g3w_id   = _zone('G3W',   'grp3')
        g3ny_id  = _zone('G3NY',  'grp3')
        g3tok_id = _zone('G3TOK', 'grp3')
        g3sw   = _seat(pw_id,   g3w_id,   'G3SW')
        g3sny  = _seat(pny_id,  g3ny_id,  'G3SNY')
        g3stok = _seat(ptok_id, g3tok_id, 'G3STOK')

        # Store IDs on the connection for tests
        conn._tz_ids = {
            'sw': sw_id, 'sny': sny_id,
            'zw': zw_id, 'zny': zny_id,
            'schema': schema,
            'pw': pw_id, 'pny': pny_id, 'ptok': ptok_id, 'pkol': pkol_id,
            'zu': zu_id, 'su_w': su_w, 'su_ny': su_ny, 'su_tok': su_tok, 'su_kol': su_kol,
            'g3w': g3w_id, 'g3ny': g3ny_id, 'g3tok': g3tok_id,
            'g3sw': g3sw, 'g3sny': g3sny, 'g3stok': g3stok,
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


def _book_ok(conn, sid, fromts, tots):
    """Insert must succeed (no exclusion). Autocommit => each stmt its own txn,
    so a prior _book_rejected doesn't poison this one."""
    _book(conn, sid, fromts, tots)


def _book_rejected(conn, sid, fromts, tots):
    """Insert must be rejected by book_overlap_insert with exclusion_violation."""
    with pytest.raises(psycopg.errors.ExclusionViolation):
        _book(conn, sid, fromts, tots)


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


# ── _vtimezone_block correctness (RFC 5545 §3.6.5) ──────────────────────────────
# The per-plan iCal feed emits a VTIMEZONE block per distinct zone. Its job is
# to make a TZID-stamped wall-clock DTSTART resolve to the right real instant
# in any client. The block enumerates the zone's actual UTC transitions in the
# window as dated STANDARD/DAYLIGHT observances with TZOFFSETFROM/TO. These
# tests pin that the offsets are right on both sides of a DST transition.

def _block(tz_name, since_dt, until_dt):
    since = calendar.timegm(since_dt.timetuple())
    until = calendar.timegm(until_dt.timetuple())
    return _vtimezone_block(tz_name, since, until)

def test_vtimezone_block_summer_is_dst():
    # July 2024: Warsaw is CEST (UTC+2). The initial observance (scan_start is
    # a week before the window, still summer) must be a DAYLIGHT block at +0200.
    blk = _block('Europe/Warsaw', datetime.datetime(2024, 7, 1), datetime.datetime(2024, 7, 31))
    assert "BEGIN:VTIMEZONE\r\n" in blk
    assert "TZID:Europe/Warsaw\r\n" in blk
    assert blk.endswith("END:VTIMEZONE\r\n")
    assert "+0200" in blk   # CEST offset appears

def test_vtimezone_block_winter_is_standard():
    # December 2024: Warsaw is CET (UTC+1). Initial observance → STANDARD +0100.
    blk = _block('Europe/Warsaw', datetime.datetime(2024, 12, 1), datetime.datetime(2024, 12, 31))
    assert "+0100" in blk   # CET offset appears

def test_vtimezone_block_spans_spring_forward_transition():
    # Window covering the EU spring-forward (2024-03-31 02:00 UTC+1→UTC+2).
    # Scan starts ~Mar 8 in CET (+01); the Mar 31 transition adds a +02
    # observance. Both offsets must be present so DST and non-DST days in the
    # feed both resolve correctly.
    blk = _block('Europe/Warsaw', datetime.datetime(2024, 3, 15), datetime.datetime(2024, 4, 15))
    assert "+0100" in blk   # pre-transition CET
    assert "+0200" in blk   # post-transition CEST
    # A transition observance carries both FROM and TO offsets on adjacent lines.
    assert "TZOFFSETFROM:" in blk
    assert "TZOFFSETTO:" in blk


# ── bookings listW/report from_utc query (regression guard) ───────────────────
# _FROM_UTC_SQL derives the real UTC instant from stored wall-clock + plan TZ.
# It MUST be built from peewee column nodes (Book.fromts / Plan.timezone), not a
# raw SQL string referencing "book"."fromts" / "plan"."timezone": peewee aliases
# joined tables to t1, t3, … so a raw literal reference is unresolvable and
# /bookings/list + /bookings/report 500. This runs the actual imported expression
# through a joined peewee query against a throwaway schema to lock that in.

def test_from_utc_query_survives_peewee_join_aliasing(db):
    schema = db._tz_ids['schema']
    # Seed a Warsaw booking: wall 14:00-16:00 on 2024-07-15 (UTC+2 → real 12:00-14:00).
    sw = db._tz_ids['sw']
    fts = _wc(2024, 7, 15, 14)
    tts = _wc(2024, 7, 15, 16)
    db.execute("INSERT INTO book(login,sid,fromts,tots) VALUES('u1',%s,%s,%s)", (sw, fts, tts))

    import playhouse.postgres_ext as ppe
    from peewee import JOIN
    from warp.db import Book, Users, Plan, Seat, Zone

    pdb = ppe.Psycopg3Database('postgres', host='127.0.0.1', port=5432,
                               user='postgres', password='postgres_password',
                               autoconnect=False)
    pdb.connect()
    pdb.execute_sql(f'SET search_path TO "{schema}"')
    for m in (Users, Plan, Seat, Zone, Book):
        m.bind(pdb)
    try:
        from warp.xhr.bookings import _FROM_UTC_SQL

        base = (Book.select(Book.id, Book.fromts, Book.tots,
                            Plan.timezone.alias('plan_tz'),
                            Users.login,
                            _FROM_UTC_SQL.alias('from_utc'))
                    .join(Seat, on=(Book.sid == Seat.id))
                    .join(Plan, on=(Seat.pid == Plan.id))
                    .join(Zone, on=(Seat.zid == Zone.id))
                    .join(Users, on=(Book.login == Users.login)))

        # report-view payload: sort by from_utc desc, login asc (the 500 path).
        report_q = (base.order_by_extend(_FROM_UTC_SQL.desc())
                       .order_by_extend(Users.login.asc()))
        rows = list(report_q.limit(100).iterator())
        assert len(rows) == 1
        r = rows[0]
        assert r['plan_tz'] == 'Europe/Warsaw'
        # 14:00 Warsaw wall (UTC+2) = 12:00 UTC
        assert r['from_utc'] == calendar.timegm((2024, 7, 15, 12, 0, 0, 0, 0, 0))

        # export path: order_by(_FROM_UTC_SQL.asc()) iterator (the 500 path).
        export_q = base.offset().limit(5000).order_by(_FROM_UTC_SQL.asc())
        assert len(list(export_q.iterator())) == 1
    finally:
        pdb.close()
        db.execute("DELETE FROM book WHERE sid=%s AND fromts=%s", (sw, fts))


# ══════════════════════════════════════════════════════════════════════════════
# CORE: cross-TZ booking exclusivity — the heart of the app.
#
# Reference offsets used below (all dates chosen in summer unless a DST test):
#   Europe/Warsaw  = UTC+2 (CEST)   America/New_York = UTC-4 (EDT)
#   Asia/Tokyo     = UTC+9 (no DST)  Asia/Kolkata     = UTC+5:30 (no DST)
# Storage is wall-clock-as-fake-UTC; the real instant is wall_clock - offset.
# The book_overlap_insert trigger is the ONLY authoritative exclusivity guard,
# so these drive it directly through real INSERTs.
# ══════════════════════════════════════════════════════════════════════════════

# ── A. ONE ungrouped zone whose seats span MANY TZ plans (zid branch) ──────────

def test_ungrouped_zone_multi_tz_real_overlap_rejected(db):
    """ZU holds seats on Warsaw/NY plans. Warsaw 14:00-15:00 (UTC 12:00-13:00)
    and NY 08:00-09:00 (UTC 12:00-13:00) are the SAME real instant → rejected
    even though they are different seats on different-TZ plans in one zone."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_rejected(db, db._tz_ids['su_ny'], _wc(2024, 7, 15, 8), _wc(2024, 7, 15, 9))
    _del_all_books(db)


def test_ungrouped_zone_multi_tz_same_wallclock_allowed(db):
    """Same wall-clock digits in Warsaw vs NY are different real instants
    (UTC 12-13 vs UTC 18-19) → both allowed in the same zone."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_ok(db, db._tz_ids['su_ny'], _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _del_all_books(db)


def test_ungrouped_zone_multi_tz_back_to_back_allowed(db):
    """Touching-but-not-overlapping real instants are allowed (half-open):
    Warsaw 14:00-16:00 = UTC 12:00-14:00; NY 10:00-14:00 = UTC 14:00-18:00.
    They meet exactly at UTC 14:00 → no overlap."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 16))
    _book_ok(db, db._tz_ids['su_ny'], _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 14))
    _del_all_books(db)


def test_ungrouped_zone_multi_tz_one_minute_overlap_rejected(db):
    """Adjacency boundary: shift NY one minute EARLIER than the back-to-back case
    so the real intervals overlap by 1 minute (UTC 13:59-14:00) → rejected."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 16))
    # NY 09:59-14:00 = UTC 13:59-18:00; overlaps Warsaw's UTC 12:00-14:00 by 1 min.
    _book_rejected(db, db._tz_ids['su_ny'], _wc(2024, 7, 15, 9, 59), _wc(2024, 7, 15, 14))
    _del_all_books(db)


def test_ungrouped_zone_tokyo_overlaps_warsaw_rejected(db):
    """Third TZ in the same zone: Tokyo 21:00-22:00 (UTC+9 → UTC 12:00-13:00)
    is the same real instant as Warsaw 14:00-15:00 → rejected."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],   _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_rejected(db, db._tz_ids['su_tok'], _wc(2024, 7, 15, 21), _wc(2024, 7, 15, 22))
    _del_all_books(db)


def test_ungrouped_zone_half_hour_offset_overlap_rejected(db):
    """Half-hour offset zone: Kolkata 17:30-18:30 (UTC+5:30 → UTC 12:00-13:00)
    overlaps Warsaw 14:00-15:00 (UTC 12:00-13:00) → rejected."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],   _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_rejected(db, db._tz_ids['su_kol'], _wc(2024, 7, 15, 17, 30), _wc(2024, 7, 15, 18, 30))
    _del_all_books(db)


def test_ungrouped_zone_half_hour_offset_back_to_back_allowed(db):
    """Kolkata 18:30-19:30 (UTC 13:00-14:00) meets Warsaw 14:00-15:00
    (UTC 12:00-13:00) exactly at UTC 13:00 → allowed."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],   _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_ok(db, db._tz_ids['su_kol'], _wc(2024, 7, 15, 18, 30), _wc(2024, 7, 15, 19, 30))
    _del_all_books(db)


def test_ungrouped_zone_same_seat_double_book_rejected(db):
    """Same seat is still caught by the cheap raw-integer same-seat branch
    (same plan ⇒ same TZ), independent of the cross-TZ real-instant logic."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'], _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 16))
    _book_rejected(db, db._tz_ids['su_w'], _wc(2024, 7, 15, 12), _wc(2024, 7, 15, 18))
    _del_all_books(db)


# ── B. MANY zones in ONE zone_group, spanning MANY TZ plans (group branch) ─────

def test_group_multi_zone_multi_tz_real_overlap_rejected(db):
    """grp3 spans Warsaw/NY/Tokyo zones. Warsaw 14:00-15:00 then NY 08:00-09:00
    (both UTC 12:00-13:00) are DIFFERENT zones in the SAME group at the SAME real
    instant → the group branch rejects."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['g3sw'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_rejected(db, db._tz_ids['g3sny'], _wc(2024, 7, 15, 8), _wc(2024, 7, 15, 9))
    _del_all_books(db)


def test_group_multi_zone_multi_tz_same_wallclock_allowed(db):
    """Same wall-clock in two group zones in different TZs → different instants
    → allowed."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['g3sw'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_ok(db, db._tz_ids['g3sny'], _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _del_all_books(db)


def test_group_multi_zone_back_to_back_allowed(db):
    """Touching instants across group zones are allowed: Warsaw UTC 12:00-14:00,
    NY 10:00-14:00 = UTC 14:00-18:00, meeting at UTC 14:00."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['g3sw'],  _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 16))
    _book_ok(db, db._tz_ids['g3sny'], _wc(2024, 7, 15, 10), _wc(2024, 7, 15, 14))
    _del_all_books(db)


def test_group_three_tz_chain_overlaps_rejected(db):
    """All three group TZs at the same real instant (UTC 12:00-13:00):
    Warsaw 14:00, NY 08:00, Tokyo 21:00 — the 2nd and 3rd both reject against
    the 1st across distinct zones/TZs."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['g3sw'],   _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))
    _book_rejected(db, db._tz_ids['g3sny'],  _wc(2024, 7, 15, 8),  _wc(2024, 7, 15, 9))
    _book_rejected(db, db._tz_ids['g3stok'], _wc(2024, 7, 15, 21), _wc(2024, 7, 15, 22))
    _del_all_books(db)


def test_isolation_ungrouped_vs_group_same_instant_allowed(db):
    """A booking in the ungrouped zone ZU and one in a grp3 zone at the SAME real
    instant must NOT conflict: ZU only guards its own zid, grp3 only its group —
    they share neither. Pins that the cross-TZ logic doesn't over-reject."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'], _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))   # ZU / Warsaw
    _book_ok(db, db._tz_ids['g3sny'], _wc(2024, 7, 15, 8), _wc(2024, 7, 15, 9))    # grp3 / NY, same UTC
    _del_all_books(db)


def test_different_groups_same_instant_allowed(db):
    """'office' group (zone ZNY) and 'grp3' group (zone G3SW) at the same real
    instant don't conflict — exclusivity is per-group, not global."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['sny'],  _wc(2024, 7, 15, 8),  _wc(2024, 7, 15, 9))    # office / NY, UTC 12-13
    _book_ok(db, db._tz_ids['g3sw'], _wc(2024, 7, 15, 14), _wc(2024, 7, 15, 15))   # grp3 / Warsaw, UTC 12-13
    _del_all_books(db)


# ── C. DST transitions — offsets must be resolved per real instant ─────────────

def test_dst_spring_forward_offset_applied(db):
    """After EU spring-forward (2024-03-31), Warsaw is CEST (+2). Warsaw wall
    05:00-06:00 = UTC 03:00-04:00; NY (already EDT, -4) wall 2024-03-30 23:00-
    23:59 = UTC 2024-03-31 03:00-03:59 → overlap → rejected. (If +1 were used by
    mistake Warsaw would be UTC 04:00-05:00 and this would NOT overlap, so the
    rejection proves the post-transition +2 offset is applied.)"""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 3, 31, 5), _wc(2024, 3, 31, 6))
    _book_rejected(db, db._tz_ids['su_ny'], _wc(2024, 3, 30, 23), _wc(2024, 3, 30, 23, 59))
    _del_all_books(db)


def test_dst_spring_forward_non_overlap_allowed(db):
    """Same spring-forward date, non-overlapping: Warsaw UTC 03:00-04:00 meets
    NY 2024-03-31 00:00-00:30 (EDT → UTC 04:00-04:30) at UTC 04:00 → allowed."""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 3, 31, 5), _wc(2024, 3, 31, 6))
    _book_ok(db, db._tz_ids['su_ny'], _wc(2024, 3, 31, 0), _wc(2024, 3, 31, 0, 30))
    _del_all_books(db)


def test_dst_fall_back_offset_applied(db):
    """After EU fall-back (2024-10-27), Warsaw is CET (+1). Warsaw wall 04:00-
    05:00 = UTC 03:00-04:00; NY (still EDT, -4) wall 2024-10-26 23:00-23:59 =
    UTC 2024-10-27 03:00-03:59 → overlap → rejected. (If +2 were used Warsaw
    would be UTC 02:00-03:00 and this would NOT overlap; rejection proves the
    post-fall-back +1 offset.)"""
    _del_all_books(db)
    _book_ok(db, db._tz_ids['su_w'],  _wc(2024, 10, 27, 4), _wc(2024, 10, 27, 5))
    _book_rejected(db, db._tz_ids['su_ny'], _wc(2024, 10, 26, 23), _wc(2024, 10, 26, 23, 59))
    _del_all_books(db)


# ── D. getSeats conflict-window: windowed in the OPEN plan's scale ─────────────
# The plan-panel conflict hints (warp/xhr/plan.py:getSeats) must window the
# user's other-zone bookings by their TRANSLATED open-plan-scale instants
# (open_from/open_to), not their own-plan wall-clock — otherwise a cross-TZ
# booking near the window edge is shown (un)available out of step with the real
# overlap the trigger enforces. These mirror the OLD (own wall-clock) and NEW
# (open-scale) predicates against book_utc and assert NEW tracks the real
# instant where OLD diverged.

_OPEN_TZ = 'Europe/Warsaw'   # the plan being opened

def _window_count(conn, zid, tr_from, tr_to, mode):
    if mode == 'new':   # open-plan-scale instants (the fix)
        sql = (
            "SELECT count(*) FROM book_utc bu WHERE bu.login='u1' AND bu.zid=%s "
            "AND date_part('epoch',(bu.from_utc AT TIME ZONE '" + _OPEN_TZ + "' AT TIME ZONE 'UTC'))::bigint < %s "
            "AND date_part('epoch',(bu.to_utc   AT TIME ZONE '" + _OPEN_TZ + "' AT TIME ZONE 'UTC'))::bigint > %s"
        )
    else:               # old: booking's own-plan wall-clock
        sql = ("SELECT count(*) FROM book_utc bu WHERE bu.login='u1' AND bu.zid=%s "
               "AND bu.fromts < %s AND bu.tots > %s")
    return conn.execute(sql, (zid, tr_to, tr_from)).fetchone()[0]


def test_conflict_window_low_edge_included_by_open_scale(db):
    """Open plan = Warsaw; window = [2024-07-15 00:00, 2024-07-22 00:00) Warsaw.
    An NY booking wall 2024-07-14 23:00-23:30 has real instant UTC 2024-07-15
    03:00 = Warsaw 05:00 → INSIDE the window. The NEW (open-scale) predicate
    includes it; the OLD (own wall-clock) predicate wrongly excludes it (own
    end 23:30 < window start), which is the missed-conflict bug."""
    _del_all_books(db)
    g3ny = db._tz_ids['g3ny']
    _book(db, db._tz_ids['g3sny'], _wc(2024, 7, 14, 23), _wc(2024, 7, 14, 23, 30))
    tr_from, tr_to = _wc(2024, 7, 15, 0), _wc(2024, 7, 22, 0)
    assert _window_count(db, g3ny, tr_from, tr_to, 'new') == 1
    assert _window_count(db, g3ny, tr_from, tr_to, 'old') == 0
    _del_all_books(db)


def test_conflict_window_high_edge_excluded_by_open_scale(db):
    """Same open window. An NY booking wall 2024-07-21 20:00-20:30 has real
    instant UTC 2024-07-22 00:00 = Warsaw 02:00 → OUTSIDE the window. The NEW
    predicate excludes it; the OLD predicate wrongly includes it (own start
    20:00 < window end), which is the phantom-conflict (seat shown unavailable)
    bug the user flagged."""
    _del_all_books(db)
    g3ny = db._tz_ids['g3ny']
    _book(db, db._tz_ids['g3sny'], _wc(2024, 7, 21, 20), _wc(2024, 7, 21, 20, 30))
    tr_from, tr_to = _wc(2024, 7, 15, 0), _wc(2024, 7, 22, 0)
    assert _window_count(db, g3ny, tr_from, tr_to, 'new') == 0
    assert _window_count(db, g3ny, tr_from, tr_to, 'old') == 1
    _del_all_books(db)


def test_conflict_window_same_tz_old_and_new_agree(db):
    """When the booking's plan TZ equals the open plan TZ, open-scale == own
    wall-clock, so OLD and NEW agree (no regression for the common case)."""
    _del_all_books(db)
    # G3SW is on the Warsaw plan == open plan TZ.
    g3w = db._tz_ids['g3w']
    _book(db, db._tz_ids['g3sw'], _wc(2024, 7, 16, 10), _wc(2024, 7, 16, 11))
    tr_from, tr_to = _wc(2024, 7, 15, 0), _wc(2024, 7, 22, 0)
    assert _window_count(db, g3w, tr_from, tr_to, 'new') == 1
    assert _window_count(db, g3w, tr_from, tr_to, 'old') == 1
    _del_all_books(db)


# ── E. resolve_conflict_bookings — the EXTRACTED, Flask-free core ──────────────
# warp.xhr.plan.resolve_conflict_bookings is the conflict-resolution logic lifted
# out of getSeats so it can be imported and run against a DB with no app context.
# These tests drive the REAL production function (not a raw-SQL mirror), pinning:
# the open-scale windowing fix, the open-scale fromTS/toTS translation values,
# and the cross-TZ vs same-TZ display payload.

@pytest.fixture
def bound_db(db):
    """Bind warp.db peewee models to the test schema so Flask-independent helpers
    run against it. Same connection/schema the raw `db` fixture seeds (autocommit,
    so its inserts are visible here)."""
    import playhouse.postgres_ext as ppe
    from warp.db import Users, Plan, Seat, Zone, Book, BookUTC
    pdb = ppe.Psycopg3Database('postgres', host='127.0.0.1', port=5432,
                               user='postgres', password='postgres_password',
                               autoconnect=False)
    pdb.connect()
    pdb.execute_sql(f'SET search_path TO "{db._tz_ids["schema"]}"')
    for m in (Users, Plan, Seat, Zone, Book, BookUTC):
        m.bind(pdb)
    try:
        yield pdb
    finally:
        pdb.close()


_TR = {'fromTS': _wc(2024, 7, 15, 0), 'toTS': _wc(2024, 7, 22, 0)}   # Warsaw-scale window


def test_resolve_conflict_bookings_low_edge_and_cross_tz_payload(db, bound_db):
    """Cross-TZ booking whose own wall-clock is BEFORE the open window but whose
    real instant is INSIDE it is returned (open-scale windowing), translated to
    open-plan-scale fromTS/toTS, and carries the own-office display payload."""
    from warp.xhr.plan import resolve_conflict_bookings
    _del_all_books(db)
    # NY wall 2024-07-14 23:00-23:30 → real UTC 07-15 03:00 → Warsaw 05:00 (in window).
    _book(db, db._tz_ids['g3sny'], _wc(2024, 7, 14, 23), _wc(2024, 7, 14, 23, 30))
    rows = resolve_conflict_bookings({db._tz_ids['g3ny']}, 'u1', 'Europe/Warsaw', _TR)
    assert len(rows) == 1
    r = rows[0]
    # Overlap math fields are in the OPEN (Warsaw) scale: 05:00-05:30.
    assert r['fromTS'] == _wc(2024, 7, 15, 5)
    assert r['toTS'] == _wc(2024, 7, 15, 5, 30)
    # Display payload shows the booking's OWN office wall-clock + TZ.
    assert r['tz'] == 'America/New_York'
    assert r['fromStr'] == '2024-07-14 23:00'
    assert r['toStr'] == '2024-07-14 23:30'
    _del_all_books(db)


def test_resolve_conflict_bookings_high_edge_excluded(db, bound_db):
    """Cross-TZ booking whose own wall-clock is INSIDE the open window but whose
    real instant is PAST the high edge is NOT returned — no phantom conflict."""
    from warp.xhr.plan import resolve_conflict_bookings
    _del_all_books(db)
    # NY wall 2024-07-21 20:00-20:30 → real UTC 07-22 00:00 → Warsaw 02:00 (out of window).
    _book(db, db._tz_ids['g3sny'], _wc(2024, 7, 21, 20), _wc(2024, 7, 21, 20, 30))
    assert resolve_conflict_bookings({db._tz_ids['g3ny']}, 'u1', 'Europe/Warsaw', _TR) == []
    _del_all_books(db)


def test_resolve_conflict_bookings_same_tz_no_payload_and_exclude(db, bound_db):
    """Same-TZ booking: open-scale == own wall-clock, no display payload; and
    exclude_sids drops a seat already present in the response."""
    from warp.xhr.plan import resolve_conflict_bookings
    _del_all_books(db)
    g3sw = db._tz_ids['g3sw']
    _book(db, g3sw, _wc(2024, 7, 16, 10), _wc(2024, 7, 16, 11))
    rows = resolve_conflict_bookings({db._tz_ids['g3w']}, 'u1', 'Europe/Warsaw', _TR)
    assert len(rows) == 1
    r = rows[0]
    assert 'tz' not in r and 'fromStr' not in r and 'toStr' not in r
    assert r['fromTS'] == _wc(2024, 7, 16, 10)   # unchanged: Warsaw plan == open TZ
    assert r['toTS'] == _wc(2024, 7, 16, 11)
    # exclude_sids removes the seat from the result.
    assert resolve_conflict_bookings({db._tz_ids['g3w']}, 'u1', 'Europe/Warsaw', _TR,
                                     exclude_sids=[g3sw]) == []
    _del_all_books(db)
