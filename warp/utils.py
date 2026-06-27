import flask

from calendar import timegm
from time import localtime,strftime,gmtime
from jsonschema import validate, ValidationError
import functools

# Debug-only time offset.  Set via POST /debug/set_time_offset (only in debug mode).
# Never non-zero in production.
_debug_time_offset: int = 0


def now():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until now"""
    """ It is timezone unaware version of unix timestamp """
    return timegm(localtime()) + _debug_time_offset

def today():
    """ Returns number of seconds since midnight 1970-1-1 in the current timezone until today's midnight"""
    """ It is utils.now() with stipped hour """

    n = now()
    return n - n % (24*3600)

# format { "fromTS": 123, "toTS": 123 }
def getTimeRange(extended = False):
    """ Returns a dict with fromTS and toTS """
    """ today's midnight, today's midnight + WEEKS_IN_ADVANCE """

    fromTS = today()

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

    # Window end: the Sunday at end of the week that is `weeks_in_advance`
    # weeks ahead of the current week. Same boundary as the old getNextWeek's
    # loop (which terminated after counting that Sunday) — equivalent to
    # getTimeRange()['toTS'] - 24*3600. (7 - today_wday) maps Sunday=6 -> 7,
    # which is exactly "today is the boundary Sunday" handled correctly (the
    # boundary is today itself + weeks_in_advance weeks).
    days_to_boundary_monday = (7 - today_wday) + weeks_in_advance * 7
    window_end_midnight = today_midnight + 24*3600 * (days_to_boundary_monday - 1)

    # Weekday header: 7 indices into the frontend's weekdaysShort array (0=Sun..6=Sat
    # = Python's %w). WEEK_START_DAY is in house convention (0=Mon..6=Sun); the
    # conversion is %w = (house + 1) % 7.
    weekday_header = [((week_start_day + i + 1) % 7) for i in range(7)]

    # Column index of a day whose house-weekday is `wd`, in a week anchored on
    # week_start_day (house): col = (wd - week_start_day) % 7.

    # Padding cell shared by leading/trailing slots (cards render empty).
    pad = lambda: {"timestamp": None, "day": None, "selectable": False, "isToday": False}

    months = []
    ts = today_midnight
    while True:
        t = gmtime(ts)
        year = t.tm_year
        month_index = t.tm_mon - 1   # 0..11
        # Anchor to the 1st of this month so past days of today's month render
        # as greyed cells (R: non-selectable days are shown, not hidden).
        month_start_ts = ts - (t.tm_mday - 1) * 24*3600

        # Days of this month, ascending.
        month_days = []
        d = month_start_ts
        while True:
            dt = gmtime(d)
            if dt.tm_year != year or dt.tm_mon != month_index + 1:
                break
            month_days.append(d)
            d += 24*3600

        # Build padded 7-cell weeks for this month.
        weeks = []
        row = [pad() for _ in range(7)]   # padding-fill defaults; overwritten where a real day lands
        col = None
        for day_mid in month_days:
            wd = gmtime(day_mid).tm_wday
            col = (wd - week_start_day) % 7
            row[col] = _cal_cell(day_mid, wd, today_midnight, window_end_midnight, omitted_weekdays)
            if col == 6:
                weeks.append(row)
                row = [pad() for _ in range(7)]
        # Flush the trailing partial week (only present if last day's col != 6).
        if col != 6:
            weeks.append(row)

        months.append({"year": year, "monthIndex": month_index, "weeks": weeks})

        # Advance past this month; stop after the month containing window_end.
        ts = d   # d is now the 1st of the next month
        if (year, month_index) == (gmtime(window_end_midnight).tm_year,
                                   gmtime(window_end_midnight).tm_mon - 1):
            break

    # defaultTs: first selectable day >= target_ts (the L151–161 default-day
    # derivation now lives in view.py, where prefs are loaded; this is the
    # target-scan half, kept here because it walks the grid cells).
    if target_ts is None:
        target_ts = today_midnight
    default_ts = None
    for m in months:
        for week in m["weeks"]:
            for cell in week:
                if cell["selectable"] and cell["timestamp"] >= target_ts:
                    default_ts = cell["timestamp"]
                    break
            if default_ts is not None:
                break
        if default_ts is not None:
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
