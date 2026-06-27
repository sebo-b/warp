# Self-check for warp.utils.getCalendarGrid.
#
# The grid drives the frontend plan-panel calendar (R1: no date math in JS; R9:
# no strings in the blob), so its structural invariants must hold exactly.
# The model is a *split-month rectangle* grid: each month is its own padded
# 7-column rectangle. Weeks never flow across a month boundary — a boundary
# week is split, with the previous month's last row trailing-padded after its
# last day and the next month's first row leading-padded back to the week-start
# before its 1st. The grid spans today's month through the month of the window
# end, and always contains at least one full calendar month.

import calendar as _cal
import flask
import pytest

from warp.utils import getCalendarGrid, gmtime, strftime, today


def _make_app(**overrides):
    app = flask.Flask(__name__)
    cfg = {
        'WEEKS_IN_ADVANCE': 1,
        'OMITTED_WEEKDAYS': [],
        'WEEK_START_DAY': 0,        # Monday-first (house default)
        'BOOK_OPEN': 0,
        'BOOK_CLOSE': 24 * 3600,
    }
    cfg.update(overrides)
    app.config.update(cfg)
    return app


def _grid(today_ts=None, target_ts=None, **cfg):
    app = _make_app(**cfg)
    with app.app_context():
        return getCalendarGrid(today_ts=today_ts, target_ts=target_ts)


def _all_real_cells(grid):
    out = []
    for m in grid['months']:
        for week in m['weeks']:
            for cell in week:
                if cell['timestamp'] is not None:
                    out.append(cell)
    return out


def _midnight(y, m, d):
    return _cal.timegm((y, m, d, 0, 0, 0, 0, 0, 0))


# ---------------------------------------------------------------------------
# Structural invariants — bind irrespective of the chosen 'today'.
# ---------------------------------------------------------------------------

def _assert_structure(grid):
    # weekdayHeader has exactly 7 entries, all 0..6.
    assert len(grid['weekdayHeader']) == 7
    assert set(grid['weekdayHeader']) == set(range(7))

    seen = set()
    real_cells = []
    for m in grid['months']:
        assert isinstance(m['weeks'], list) and m['weeks']
        for week in m['weeks']:
            assert len(week) == 7, f"week not 7 cells: {week}"
            for cell in week:
                assert set(cell) == {'timestamp', 'day', 'selectable', 'isToday'}
                if cell['timestamp'] is None:
                    assert cell['day'] is None
                    assert cell['selectable'] is False
                    assert cell['isToday'] is False
                else:
                    assert cell['day'] is not None and 1 <= cell['day'] <= 31
                    assert cell['timestamp'] % (24 * 3600) == 0, "non-midnight timestamp"
                    assert cell['timestamp'] not in seen, "duplicate timestamp"
                    seen.add(cell['timestamp'])
                    real_cells.append(cell)

    # Real cells form a contiguous ascending run of day-midnights (the grid has
    # no internal gaps — weeks flow across month boundaries, no intra-padding).
    real_cells.sort(key=lambda c: c['timestamp'])
    for a, b in zip(real_cells, real_cells[1:]):
        assert b['timestamp'] - a['timestamp'] == 24 * 3600, "non-contiguous day run"

    # defaultTs, when set, must be a selectable day >= target_ts (target_ts
    # defaults to today when None).
    if grid['defaultTs'] is not None:
        sel = [c for c in real_cells if c['timestamp'] == grid['defaultTs']]
        assert sel, "defaultTs not among real cells"
        assert sel[0]['selectable'], "defaultTs not selectable"
    return real_cells


def test_structure_midweek_no_omissions():
    # Wed 2026-06-24 (tm_wday=2), WEEKS_IN_ADVANCE=1.
    ts = _midnight(2026, 6, 24)
    grid = _grid(today_ts=ts, target_ts=ts)
    _assert_structure(grid)

    # Two month blocks: June (from the current week's Monday) and July (through
    # month-end of the window's month). The window ends Sun 2026-07-05.
    assert [(m['year'], m['monthIndex']) for m in grid['months']] == [(2026, 5), (2026, 6)]

    real = {c['timestamp']: c for c in _all_real_cells(grid)}
    # Grid starts at the Monday of the current week (2026-06-22); days of prior
    # weeks are NOT shown (the window is week-aligned and forward-looking).
    assert min(real) == _midnight(2026, 6, 22)
    assert _midnight(2026, 6, 21) not in real and _midnight(2026, 6, 1) not in real
    # Past days of the current week render as greyed REAL cells (not padding):
    assert real[_midnight(2026, 6, 22)]['selectable'] is False
    assert real[_midnight(2026, 6, 23)]['selectable'] is False
    # Today renders as today + selectable.
    assert real[ts]['isToday'] is True and real[ts]['selectable'] is True
    # Window end: Sun 2026-07-05 selectable, Mon 2026-07-06 greyed.
    assert real[_midnight(2026, 7, 5)]['selectable'] is True
    assert real[_midnight(2026, 7, 6)]['selectable'] is False
    # Grid extends to the last day of the window's month (2026-07-31).
    assert max(real) == _midnight(2026, 7, 31)

    # defaultTs default target = today -> today itself.
    assert grid['defaultTs'] == ts


def test_user_scenario_two_weeks_advance():
    # The reviewer's scenario: today Sat 2026-06-27, WEEKS_IN_ADVANCE=2.
    # Expect: grid starts Mon 2026-06-22; selectable through Sun 2026-07-12;
    # greyed from Mon 2026-07-13 to Fri 2026-07-31 (end of July).
    ts = _midnight(2026, 6, 27)
    grid = _grid(today_ts=ts, target_ts=ts, WEEKS_IN_ADVANCE=2)
    _assert_structure(grid)
    real = {c['timestamp']: c for c in _all_real_cells(grid)}
    assert min(real) == _midnight(2026, 6, 22)
    assert max(real) == _midnight(2026, 7, 31)
    sel = sorted(t for t, c in real.items() if c['selectable'])
    assert sel[0] == _midnight(2026, 6, 27)   # today
    assert sel[-1] == _midnight(2026, 7, 12)  # boundary Sunday
    # Days of the current week before today are greyed, real, not shown-as-past-week.
    assert real[_midnight(2026, 6, 22)]['selectable'] is False
    # Post-window tail greys through month-end.
    assert real[_midnight(2026, 7, 13)]['selectable'] is False
    assert real[_midnight(2026, 7, 31)]['selectable'] is False


def test_defaultTs_boundary_target_bumps_to_tomorrow_when_past_open():
    # The boundary/tomorrow/same derivation lives in view.py; getCalendarGrid
    # only applies the target scan. Pass target_ts = tomorrow and assert
    # defaultTs = next selectable >= tomorrow.
    ts = _midnight(2026, 6, 24)
    tomorrow = ts + 24 * 3600
    grid = _grid(today_ts=ts, target_ts=tomorrow)
    _assert_structure(grid)
    assert grid['defaultTs'] == tomorrow


def test_defaultTs_none_when_target_past_window_end():
    # If the requested target is past every selectable day, defaultTs is None.
    ts = _midnight(2026, 6, 24)
    far_future = ts + 365 * 24 * 3600
    grid = _grid(today_ts=ts, target_ts=far_future)
    _assert_structure(grid)
    assert grid['defaultTs'] is None


def test_omitted_weekdays_greyed_not_hidden():
    # OMIT Sat,Sun: weekend cells render (real, with day numbers) but are not
    # selectable — they are greyed, never hidden, per the spec.
    ts = _midnight(2026, 6, 24)
    grid = _grid(today_ts=ts, target_ts=ts, OMITTED_WEEKDAYS=[5, 6])
    _assert_structure(grid)
    real = {c['timestamp']: c for c in _all_real_cells(grid)}
    # 2026-06-27 is a Saturday inside the window — rendered but not selectable.
    assert real[_midnight(2026, 6, 27)]['selectable'] is False
    assert real[_midnight(2026, 6, 27)]['day'] == 27
    # 2026-06-25 (Fri) still selectable.
    assert real[_midnight(2026, 6, 25)]['selectable'] is True
    # defaultTs skips weekends; today (Wed) is selectable.
    assert grid['defaultTs'] == ts


def test_week_start_day_rotates_header():
    # Monday-first -> header = [Mon..Sun] in %w indices -> [1,2,3,4,5,6,0]
    assert _grid(today_ts=_midnight(2026, 6, 24),
                 target_ts=_midnight(2026, 6, 24),
                 WEEK_START_DAY=0)['weekdayHeader'] == [1, 2, 3, 4, 5, 6, 0]
    # Saturday-first (WEEK_START_DAY=5) -> header starts Sun (index 0) then Mon..
    assert _grid(today_ts=_midnight(2026, 6, 24),
                 target_ts=_midnight(2026, 6, 24),
                 WEEK_START_DAY=6)['weekdayHeader'] == [0, 1, 2, 3, 4, 5, 6]


def test_months_are_split_padded_rectangles_no_flow_across_boundary():
    # Each month is its own padded rectangle; a week crossing a month boundary
    # is SPLIT -- June's last row ends at Jun 30 (trailing padding to complete
    # the 7-cell row), July's first row starts at Jul 1 (leading padding back to
    # FWD). No days flow across the boundary.
    ts = _midnight(2026, 6, 27)   # Sat, WEEKS_IN_ADVANCE=2 -> END Jul 12
    grid = _grid(today_ts=ts, target_ts=ts, WEEKS_IN_ADVANCE=2)
    _assert_structure(grid)
    june = grid['months'][0]
    july = grid['months'][1]
    # June: starts Mon 22 (FWD of current week, no leading pad), ends Tue 30,
    # trailing padding to complete the row.
    assert [c['day'] for c in june['weeks'][0]] == [22, 23, 24, 25, 26, 27, 28]
    assert [c['day'] for c in june['weeks'][1]] == [29, 30, None, None, None, None, None]
    # July: leading padding before Wed Jul 1, full middle weeks, trailing pad after Fri 31.
    assert [c['day'] for c in july['weeks'][0]] == [None, None, 1, 2, 3, 4, 5]
    assert [c['day'] for c in july['weeks'][-1]] == [27, 28, 29, 30, 31, None, None]
    # No boundary week flows: June has no July days, July has no June days.
    for w in june['weeks']:
        for c in w:
            if c['timestamp'] is not None:
                assert gmtime(c['timestamp']).tm_mon == 6
    for w in july['weeks']:
        for c in w:
            if c['timestamp'] is not None:
                assert gmtime(c['timestamp']).tm_mon == 7


def test_blob_contains_no_strings():
    # R9: the backend grid output is data only (ints/flags/enums); it never
    # emits a localized string. Walk every value and assert no str instances.
    grid = _grid(today_ts=_midnight(2026, 6, 24), target_ts=_midnight(2026, 6, 24))

    def walk(v):
        if isinstance(v, str):
            raise AssertionError(f"string leaked into grid blob: {v!r}")
        if isinstance(v, dict):
            for item in v.values():
                walk(item)
        elif isinstance(v, list):
            for item in v:
                walk(item)
        # ints/bools/None are fine; nothing else should appear.

    walk(grid)


def test_real_cells_align_to_weekday_header():
    # Each real cell's column equals its weekday's position in the header, so
    # the frontend never needs to recompute alignment (R1: zero date math).
    ts = _midnight(2026, 6, 24)
    for week_start in (0, 1, 3, 5, 6):
        grid = _grid(today_ts=ts, target_ts=ts, WEEK_START_DAY=week_start)
        _assert_structure(grid)
        header = grid['weekdayHeader']
        for m in grid['months']:
            for week in m['weeks']:
                for col, cell in enumerate(week):
                    if cell['timestamp'] is None:
                        continue
                    # %w (0=Sun..6=Sat) of the cell's day must match header[col].
                    cell_wday = int(strftime('%w', gmtime(cell['timestamp'])))
                    assert cell_wday == header[col], (
                        f"weekday mismatch week_start={week_start} col={col} "
                        f"got {cell_wday} header={header}")
