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

    # Window end (last selectable day): the Sunday at the end of the week that is
    # `weeks_in_advance` weeks ahead of the current week. Same boundary as the old
    # getNextWeek loop (which counted Sundays until <= weeks_in_advance) — the
    # last selectable day. (6 - today_wday) % 7 is the day-count from today to
    # this week's ending Sunday (Sun=6); today=Sun gives 0 (boundary = today).
    window_end_offset_days = ((6 - today_wday) % 7) + weeks_in_advance * 7
    window_end_midnight = today_midnight + 24*3600 * window_end_offset_days

    # Grid start = the configured week-start day (house convention) of the
    # CURRENT week, on or before today. The booking window is week-aligned and
    # forward-looking, so the grid begins at the Monday (or configured start) of
    # today's week — days of prior weeks have no booking value and are not shown.
    grid_start = today_midnight - ((today_wday - week_start_day) % 7) * 24*3600

    # Grid end = last day of the month containing window_end, so a window
    # crossing a month boundary renders through the end of that month (the
    # post-window tail greys out to month-end, per the spec).
    we_t = gmtime(window_end_midnight)
    next_month_start = timegm((we_t.tm_year, we_t.tm_mon % 12 + 1, 1, 0, 0, 0, 0, 0, 0))
    grid_end = next_month_start - 24*3600

    # Weekday header: 7 indices into the frontend's weekdaysShort array (0=Sun..6=Sat
    # = Python's %w). WEEK_START_DAY is in house convention (0=Mon..6=Sun); the
    # conversion is %w = (house + 1) % 7. Pre-rotated so the frontend renders
    # columns in wire order, zero date math.
    weekday_header = [((week_start_day + i + 1) % 7) for i in range(7)]

    # One continuous run of days from grid_start to grid_end, each a real cell.
    # Weeks flow across month boundaries (a week belongs to the month of its
    # first day) so there are no empty intra-grid padding cells — only the final
    # week is padded tail-end to complete a 7-cell row.
    pad = lambda: {"timestamp": None, "day": None, "selectable": False, "isToday": False}

    days = []
    ts = grid_start
    while ts <= grid_end:
        wd = gmtime(ts).tm_wday
        days.append(_cal_cell(ts, wd, today_midnight, window_end_midnight, omitted_weekdays))
        ts += 24*3600

    # Group into 7-cell weeks; pad the trailing partial week at the very end.
    weeks = []
    for i in range(0, len(days), 7):
        week = days[i:i+7]
        while len(week) < 7:
            week.append(pad())
        weeks.append(week)

    # Assign each week to a month block by its first real cell's month — a week
    # is owned by the month it starts in, so a boundary week (e.g. Jun 29-Jul 5)
    # sits under the June header with its July days still rendered as real cells.
    months = []
    for week in weeks:
        first_real = next((c["timestamp"] for c in week if c["timestamp"] is not None), None)
        if first_real is None:
            continue
        ft = gmtime(first_real)
        mi, yr = ft.tm_mon - 1, ft.tm_year
        if not months or months[-1]["monthIndex"] != mi or months[-1]["year"] != yr:
            months.append({"year": yr, "monthIndex": mi, "weeks": []})
        months[-1]["weeks"].append(week)

    # defaultTs: first selectable day >= target_ts (the L151-161 default-day
    # derivation now lives in view.py, where prefs are loaded; this is the
    # target-scan half, kept here because it walks the grid cells).
    if target_ts is None:
        target_ts = today_midnight
    default_ts = None
    for week in weeks:
        for cell in week:
            if cell["selectable"] and cell["timestamp"] >= target_ts:
                default_ts = cell["timestamp"]
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
