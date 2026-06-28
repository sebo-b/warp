import datetime
import flask

from calendar import timegm
from time import localtime,strftime,gmtime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from jsonschema import validate, ValidationError
import functools
from peewee import Expression, fn, SQL

# Debug-only time offset.  Set via POST /debug/set_time_offset (only in debug mode).
# Never non-zero in production.
_debug_time_offset: int = 0


def now(tz=None):
    """Current wall-clock in the given IANA zone as a fake-UTC integer.

    tz=None falls back to DEFAULT_PLAN_TIMEZONE; if that is also unset,
    falls back to localtime() (existing behaviour).  The returned integer
    uses the same fake-UTC scale as stored fromts/tots: the zone's wall-clock
    digits treated as UTC seconds since epoch."""
    if tz is None:
        try:
            tz = flask.current_app.config.get('DEFAULT_PLAN_TIMEZONE') or None
        except RuntimeError:
            tz = None
    if tz:
        dt = datetime.datetime.now(tz=ZoneInfo(tz))
        return timegm(dt.timetuple()) + _debug_time_offset
    return timegm(localtime()) + _debug_time_offset

def today(tz=None):
    """Wall-clock midnight in the given IANA zone as a fake-UTC integer."""
    n = now(tz)
    return n - n % (24*3600)

# --- peewee SQL helpers (TZ-aware, honor the debug offset) -------------------
# Mirrors of now()/today() for use inside peewee WHERE/SELECT expressions,
# where the comparison must run in the DB (per-row, against a TZ column) and
# so can't use the Python-int versions above. Both honor _debug_time_offset
# (e2e virtual time via /debug/set_time_offset) exactly like now()/today() do;
# _debug_time_offset stays private to this module.

def now_sql():
    """SQL now() advanced by the debug time-offset, as a peewee node (timestamptz).

    Encapsulates _debug_time_offset so callers never touch the private
    attribute. In production _debug_time_offset == 0, so this is just now().
    The bound parameter means the offset value never reaches SQL text."""
    return SQL("(now() + make_interval(secs => %s))", (_debug_time_offset,))

def today_in_tz_sql(tz_col, as_epoch=False):
    """Wall-clock midnight today in each row's TZ, as a peewee expression.

    tz_col is a peewee column holding an IANA name (e.g. Plan.timezone or
    BookUTC.timezone). The shifted now() (see now_sql()) is interpreted in
    the row's TZ, truncated to wall-clock midnight, and back to a real instant.
    Returns timestamptz by default; as_epoch=True returns bigint seconds-since-
    epoch (to compare against a ::bigint expression like _FROM_UTC_SQL)."""
    midnight = Expression(
        fn.date_trunc('day', Expression(now_sql(), 'AT TIME ZONE', tz_col)),
        'AT TIME ZONE', tz_col)
    if as_epoch:
        return fn.date_part('epoch', midnight).cast('bigint')
    return midnight

def is_valid_iana(name):
    """Return True iff name is a valid IANA timezone name resolvable by zoneinfo."""
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, KeyError, ValueError):
        return False

# format { "fromTS": 123, "toTS": 123 }
def getTimeRange(extended=False, tz=None):
    """ Returns a dict with fromTS and toTS """
    """ today's midnight, today's midnight + WEEKS_IN_ADVANCE """

    fromTS = today(tz)

    weeksInAdvance = flask.current_app.config['WEEKS_IN_ADVANCE']
    if extended:
        weeksInAdvance += 2

    t = gmtime(fromTS)
    toTS = (7 - t.tm_wday) + weeksInAdvance*7
    toTS = 24*3600*toTS + fromTS

    return { "fromTS": fromTS, "toTS": toTS}

# format
# {
#   weekdayHeader: [0..6],     # 7 indices into the frontend's weekdaysShort
#                             #   array (indexed 0=Sun..6=Sat, Python's %w),
#                             #   pre-rotated by WEEK_START_DAY so the frontend
#                             #   renders columns in wire order, zero date math.
#   months: [
#     { year, monthIndex, weeks: [ [ cell x7 ], [ cell x7 ], ... ] }
#   defaultTs: <int|null>     # the first selectable day >= target_ts (null if
#                             # none in range)
# }
#
# cell = { timestamp: int|null, day: int|null, selectable: bool, isToday: bool }
#   timestamp: day-midnight UTC-as-local (the same unit as today());
#               null for week-padding fillers.
#   day:       1..31 for real days; null for padding.
#   selectable: today..windowEnd AND weekday not in OMITTED_WEEKDAYS.
#   isToday:   flags today.
#
# Pure data only — no localized strings (R9). All labels come from the
# frontend's existing i18n arrays. This makes the TZ trap structurally
# impossible: the frontend never calls new Date(ts) to derive a day identity
# (R1) — it just lays out the cells in wire order.
def getCalendarGrid(today_ts=None, target_ts=None):
    """Returns a pure-data blob (no strings) describing a rectangular whole-month
    calendar grid from today's month through the month of the last selectable day.
    Drives the frontend plan-panel calendar; the frontend only renders the cells
    and manages selection, doing zero date math (R1, R9)."""

    config = flask.current_app.config
    weeks_in_advance = config['WEEKS_IN_ADVANCE']
    omitted_weekdays = config['OMITTED_WEEKDAYS']   # 0=Mon..6=Sun (== tm_wday)
    week_start_day = config['WEEK_START_DAY']       # 0=Mon..6=Sun (== tm_wday)

    if today_ts is None:
        today_ts = today()

    # Floor to midnight (today() already is; defensive for tests).
    today_midnight = today_ts - (today_ts % (24*3600))

    today_wday = gmtime(today_midnight).tm_wday     # 0=Mon..6=Sun (== house convention)

    # START / END of the bookable span (see PLAN §4.1). END is the LWD of the
    # week that is `weeks_in_advance` full weeks after the current one — same
    # boundary as getTimeRange() (apply's code-103 check) minus one second.
    start_midnight = today_midnight
    window_end_offset_days = ((6 - today_wday) % 7) + weeks_in_advance * 7
    end_midnight = today_midnight + 24*3600 * window_end_offset_days

    # --- Grid bounds: always full weeks; always >= one full calendar month. ---
    def first_of_month(y, mo):
        return timegm((y, mo, 1, 0, 0, 0, 0, 0, 0))
    def last_of_month(y, mo):
        ny, nm = (y + 1, 1) if mo == 12 else (y, mo + 1)
        return first_of_month(ny, nm) - 24*3600
    def fwd_of(ts):
        # The configured week-start day (house) of the week containing ts.
        return ts - ((gmtime(ts).tm_wday - week_start_day) % 7) * 24*3600

    start_t = gmtime(start_midnight)
    end_t = gmtime(end_midnight)

    # Does START..END already enclose a full calendar month? (some month M whose
    # 1st >= START and last day <= END.)
    enclosed = False
    y, mo = start_t.tm_year, start_t.tm_mon
    while (y, mo) <= (end_t.tm_year, end_t.tm_mon):
        first = first_of_month(y, mo)
        last = last_of_month(y, mo)
        if first >= start_midnight and last <= end_midnight:
            enclosed = True
            break
        y, mo = (y + 1, 1) if mo == 12 else (y, mo + 1)

    if enclosed:
        # Full month already covered -> don't extend; grid ends at END (an LWD,
        # so the final week needs no trailing padding).
        grid_start = fwd_of(start_midnight)
        grid_end = end_midnight
    else:
        # No full month enclosed -> extend the grid to show the full calendar
        # month END belongs to (its 1st..last day).
        grid_end = last_of_month(end_t.tm_year, end_t.tm_mon)
        if (end_t.tm_year, end_t.tm_mon) == (start_t.tm_year, start_t.tm_mon):
            # Same month: pull the start back to the 1st so the whole month is
            # visible (padded to FWD of that week for the rectangle rule).
            grid_start = fwd_of(first_of_month(end_t.tm_year, end_t.tm_mon))
        else:
            grid_start = fwd_of(start_midnight)

    # Padding cell shared by leading/trailing slots (empty cards).
    pad = lambda: {"timestamp": None, "day": None, "selectable": False, "isToday": False}

    # Weekday header: 7 indices into the frontend's weekdaysShort array (0=Sun..6=Sat
    # = Python's %w). WEEK_START_DAY is house (0=Mon..6=Sun); %w = (house + 1) % 7.
    # Pre-rotated so the frontend renders columns in wire order, zero date math.
    weekday_header = [((week_start_day + i + 1) % 7) for i in range(7)]

    # Each month is its own padded rectangle. A week that crosses a month
    # boundary is SPLIT: the prev month's last row ends at its last day (then
    # trailing padding to complete the 7-cell row), and the next month's first
    # row starts at its 1st (leading padding back to FWD). Weeks fully inside a
    # month are full 7-cell rows. No days flow across the boundary — month
    # boundaries are clean breaks. (Review point 1: "full if not crossing month
    # boundaries, otherwise split and end where they end, start with month start.")
    months = []
    all_cells = []   # flat real-day list, for the defaultTs scan
    ts = grid_start
    while ts <= grid_end:
        t = gmtime(ts)
        year, mo = t.tm_year, t.tm_mon
        # First / last day of THIS month that fall within the grid.
        m_start = max(ts, first_of_month(year, mo))
        m_end = min(grid_end, last_of_month(year, mo))
        m_days = []
        d = m_start
        while d <= m_end:
            m_days.append(_cal_cell(d, gmtime(d).tm_wday, start_midnight, end_midnight, omitted_weekdays))
            d += 24*3600
        # Leading padding: columns before the first day's weekday, back to FWD.
        lead = (gmtime(m_start).tm_wday - week_start_day) % 7
        # Trailing padding: columns after the last day to complete the 7-cell row.
        trail = (6 - ((gmtime(m_end).tm_wday - week_start_day) % 7)) % 7
        cells = [pad() for _ in range(lead)] + m_days + [pad() for _ in range(trail)]
        weeks = [cells[i:i+7] for i in range(0, len(cells), 7)]
        months.append({"year": year, "monthIndex": mo - 1, "weeks": weeks})
        all_cells.extend(m_days)
        ts = m_end + 24*3600   # advance to the 1st of the next month

    # defaultTs: first selectable day >= target_ts (the L151-161 default-day
    # derivation now lives in view.py, where prefs are loaded; this is the
    # target-scan half, kept here because it walks the grid cells).
    if target_ts is None:
        target_ts = today_midnight
    default_ts = None
    for cell in all_cells:
        if cell["selectable"] and cell["timestamp"] >= target_ts:
            default_ts = cell["timestamp"]
            break

    return {
        "weekdayHeader": weekday_header,
        "months": months,
        "defaultTs": default_ts,
    }


def _cal_cell(day_mid, wd, today_midnight, window_end_midnight, omitted_weekdays):
    return {
        "timestamp": day_mid,
        "day": gmtime(day_mid).tm_mday,
        "selectable": (today_midnight <= day_mid <= window_end_midnight) and (wd not in omitted_weekdays),
        "isToday": (day_mid == today_midnight),
    }


def formatTimestamp(ts):

    t = gmtime(ts)
    return strftime("%Y-%m-%d %H:%M",t)

def formatTimespan(fromTS, toTS):
    fromT = gmtime(fromTS)
    toT = gmtime(toTS)

    if (fromT[0],fromT[1],fromT[2]) ==  (toT[0],toT[1],toT[2]):
        return strftime("%a, %Y-%m-%d %H:%M",fromT)+strftime("-%H:%M",toT)
    else:
        return strftime("%Y-%m-%d %H:%M",fromT)+strftime(" - %Y-%m-%d %H:%M",toT)

def validateJSONInput(jsonSchema, isAdmin = False):

    def inner(func):

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
                if not flask.request.is_json:
                    return {"msg": "Non-JSON request", "code": 10 }, 404

                if isAdmin and not flask.g.isAdmin:
                    return {"msg": "Forbidden", "code": 11 }, 403

                from werkzeug.exceptions import BadRequest

                try:
                    jsonData = flask.request.get_json()
                    validate(jsonData,jsonSchema)
                except BadRequest:
                    return {"msg": "Error in parsing JSON", "code": 12 }, 404
                except ValidationError as err:
                    return {"msg": "Data error", "code": 13 }, 400

                return func(*args, **kwargs)

        return wrapper

    return inner
