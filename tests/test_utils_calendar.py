# Self-check for warp.utils.getCalendarGrid.
#
# The frontend trusts the backend's cell data verbatim (R1: no date math in JS;
# R9: no strings in the blob), so the grid's structural invariants must hold
# exactly: rectangular padded weeks, contiguous run of real day-midnights, no
# duplicate timestamps, selectable cells only inside [today, windowEnd] and not
# omitted, and defaultTs (when set) selectable and >= the requested target.
#
# Pentyl: one runnable check, no framework beyond what utils already imports —
# aligns with the existing `python -m pytest tests/` harness from the repo

import calendar as _cal
import flask
import pytest

from warp.utils import getCalendarGrid, gmtime, strftime, today


# The function reads WEEKS_IN_ADVANCE / OMITTED_WEEKDAYS / WEEK_START_DAY /
# BOOK_OPEN from flask.current_app.config, so every test runs inside an app
# context with the config pinned to a known baseline.
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
                # cell is a pure-data dict with exactly the 4 keys.
                assert set(cell) == {'timestamp', 'day', 'selectable', 'isToday'}
                if cell['timestamp'] is None:
                    # padding filler
                    assert cell['day'] is None
                    assert cell['selectable'] is False
                    assert cell['isToday'] is False
                else:
                    assert cell['day'] is not None and 1 <= cell['day'] <= 31
                    assert cell['timestamp'] % (24 * 3600) == 0, "non-midnight timestamp"
                    assert cell['timestamp'] not in seen, "duplicate timestamp"
                    seen.add(cell['timestamp'])
                    real_cells.append(cell)

    # Real cells form a contiguous ascending run of day-midnights.
    real_cells.sort(key=lambda c: c['timestamp'])
    for a, b in zip(real_cells, real_cells[1:]):
        assert b['timestamp'] - a['timestamp'] == 24 * 3600, "non-contiguous day run"

    # defaultTs, when set, must be a selectable day >= target_ts (target_ts defaults
    # to today when None).
    if grid['defaultTs'] is not None:
        sel = [c for c in real_cells if c['timestamp'] == grid['defaultTs']]
        assert sel, "defaultTs not among real cells"
        assert sel[0]['selectable'], "defaultTs not selectable"
    return real_cells


def test_structure_midweek_no_omissions():
    # Wed 2026-06-24 (tm_wday=2).
    ts = _midnight(2026, 6, 24)
    grid = _grid(today_ts=ts, target_ts=ts)
    _assert_structure(grid)

    # Two months: June (today's month) and July (month of the window end).
    assert [(m['year'], m['monthIndex']) for m in grid['months']] == [(2026, 5), (2026, 6)]

    # Window end = Sunday ending the week weeks_in_advance weeks ahead
    # (= 2026-07-05 for today=2026-06-24 & WEEKS_IN_ADVANCE=1), so Jul 5 is
    # selectable and Jul 6 is greyed.
    real = {c['timestamp']: c for c in _all_real_cells(grid)}
    assert real[_midnight(2026, 7, 5)]['selectable'] is True
    assert real[_midnight(2026, 7, 6)]['selectable'] is False

    # Past days in today's month render as greyed REAL cells (not padding):
    assert real[_midnight(2026, 6, 1)]['selectable'] is False
    assert real[_midnight(2026, 6, 23)]['selectable'] is False
    # Today renders as today + selectable.
    assert real[ts]['isToday'] is True and real[ts]['selectable'] is True

    # defaultTs default target = today → today itself.
    assert grid['defaultTs'] == ts


def test_defaultTs_boundary_target_bumps_to_tomorrow_when_past_open():
    # WEEKS_IN_ADVANCE=1, today Wed 2026-06-24. The boundary target uses the
    # caller-supplied target_ts (the boundary/tomorrow/same deriviation lives
    # in view.py — getCalendarGrid only applies the scan). So pass target_ts =
    # tomorrow and assert defaultTs = next selectable >= tomorrow.
    ts = _midnight(2026, 6, 24)
    tomorrow = ts + 24 * 3600
    grid = _grid(today_ts=ts, target_ts=tomorrow)
    _assert_structure(grid)
    assert grid['defaultTs'] == tomorrow


def test_defaultTs_none_when_target_past_window_end():
    # If the requested target is past every selectable day, defaultTs is None
    # (graceful — the frontend falls back to an unselected calendar).
    ts = _midnight(2026, 6, 24)
    far_future = ts + 365 * 24 * 3600
    grid = _grid(today_ts=ts, target_ts=far_future)
    _assert_structure(grid)
    assert grid['defaultTs'] is None
    # defaultSelectedDates.cb is left unset (frontend shows no pre-selected day).


def test_omitted_weekdays_greyed_not_hidden():
    # OMIT_Sat,Sun: weekend cells render (real, with day numbers) but are not
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
    # defaultTs skips weekends (Sat/Sun not selectable).
    assert grid['defaultTs'] == ts  # today (Wed) is selectable


def test_week_start_day_rotates_header():
    # Monday-first → header = [Mon..Sun] in %w indices → [1,2,3,4,5,6,0]
    assert _grid(today_ts=_midnight(2026, 6, 24),
                 target_ts=_midnight(2026, 6, 24),
                 WEEK_START_DAY=0)['weekdayHeader'] == [1, 2, 3, 4, 5, 6, 0]
    # Saturday-first (WEEK_START_DAY=5) → header starts Sun (index 0) then Mon..
    assert _grid(today_ts=_midnight(2026, 6, 24),
                 target_ts=_midnight(2026, 6, 24),
                 WEEK_START_DAY=6)['weekdayHeader'] == [0, 1, 2, 3, 4, 5, 6]


def test_month_boundary_renders_both_blocks():
    # today near the end of June — window spans into July; both month blocks
    # render with weekday-aligned leading/trailing padding.
    ts = _midnight(2026, 6, 29)  # Monday
    grid = _grid(today_ts=ts, target_ts=ts)
    _assert_structure(grid)
    assert [(m['year'], m['monthIndex']) for m in grid['months']] == [(2026, 5), (2026, 6)]
    # First week of June-block has the 1st at the Monday column (col 0, no leading
    # padding) since both June 1 and June 29 are Mondays.
    june_week0 = grid['months'][0]['weeks'][0]
    # Last week of June-block: 29 (Mon) and 30 (Tue) then 5 padding fillers.
    last_june_week = grid['months'][0]['weeks'][-1]
    days_in_last_week = [c['day'] for c in last_june_week]
    assert 29 in days_in_last_week and 30 in days_in_last_week
    assert days_in_last_week.count(None) == 5


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
