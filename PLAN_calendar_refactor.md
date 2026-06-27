# PLAN — Replace booking date list with a lightweight calendar grid

**Status:** Draft for execution. Implemented by another agent (step 3), reviewed afterwards (step 4).
**Branch:** new feature branch off `main` (see §1).
**Ponytail:** active. The booking window is bounded (today + `WEEKS_IN_ADVANCE`), so a hand-rendered grid operating directly on the server's timestamps is lighter, TZ-safe by construction, and adds no dependency. A full calendar library is over-engineering for a ~2-week forward window.

---

## 0. Goal & decisions (locked)

Replace the booking **date checkbox list** (`#plan_sidepanel` → `.plan_datelist` → `.date_checkbox`) with a small **custom calendar grid** that:

- renders a **rectangular calendar** of whole months — from **today's month** through the **month containing the last selectable window day** — each month a standard padded month-grid (leading/trailing weekday fillers) so the first and last week are **never cut** by today or a month boundary;
- shows **every day** as a cell. **Non-selectable days are greyed out, not hidden.** A day is non-selectable when it is: before today (past), an `OMITTED_WEEKDAYS` day, after the booking window, or a week/month padding filler. Selectable days = today → end of the `WEEKS_IN_ADVANCE` window, minus omitted weekdays;
- shows the **month name** as a header per month block, so a window crossing a month boundary stays readable;
- starts columns at a **configurable week-start day** (new `WEEK_START_DAY` config var; "usually Monday or Saturday");
- supports **single**, **multiple non-contiguous**, and **range** selection via a simple mode toggle (default **Range**);
- is **mobile-friendly** and **unifies desktop/mobile**: the panel is an overlay on both, shown **by default on desktop (hideable)** and **hidden by default on mobile**, reopening via the existing schedule trigger.

**Report header filters: NOT touched.** This change is tailored to the booking (plan) view only; the report/My-Bookings Materialize datepickers stay as-is.

### Decision — backend-driven grid (locked)
The grid **range and cell data are computed by the backend** (`getCalendarGrid()` in `warp/utils.py`); the frontend only **renders** the emitted cells and manages selection. Reasons:

- **TZ-safety is structural.** Date arithmetic (week-start anchoring, month-end padding, weekday columns) belongs next to `getNextWeek` in Python (`gmtime`/`strftime`), where the timestamps already live. A frontend grid would have to `new Date(ts)`, walking straight into the documented TZ trap; the backend path keeps the frontend `Date`-free entirely.
- **Single source of truth.** The window/omitted/week-start/selectable rules already live in Python (`getNextWeek`, `getTimeRange`, apply code-103). One engine; a frontend grid duplicates these rules in a second language and they drift.
- **Simpler per-side.** Backend does trivial Python date math it already does; the frontend calendar module becomes dumb (render list → handle clicks → manage selection). Total complexity is lower than a frontend that must both compute *and* render.
- **Matches the existing pattern.** `getNextWeek` already emits presentational structured day data (`timestamp`, `date`, `weekdayN`); a richer cell list is the same pattern, not new architecture. `getNextWeek` is used **only** by `view.py::plan`, so replacing it there is zero cross-impact.

### Decision — no backend i18n (locked)
warp's i18n is **100% client-side** (`base.js` loads `LANGUAGE_FILE` via XHR → `warpGlobals.i18n` → `TR()`); the backend never touches i18n except the documented `ical.py` exception. The grid honours this:

- The backend emits **pure data only** — integers/flags/enums (`timestamp`, `day`, `selectable`, `isToday`, `monthIndex`, `year`, weekday-header indices). **Never a localized string.**
- The frontend labels every cell from its existing i18n arrays: weekday header from `weekdaysShort`; month name from `datePicker.i18n_object.monthsShort` (reused, not duplicated — see §7). Day numbers and the today-highlight are i18n-free.
- This is exactly the existing data/label split: `getNextWeek` already emits `weekdayN`/`date` and the template does `TR('weekdaysShort.{{weekdayN}}')`.

### Timezone basis (rule of the codebase)
warp is intentionally TZ-unaware: all timestamps are **UTC-epoch-seconds treated as wall-clock local** (server `gmtime`/`strftime("%Y-%m-%d")`, `utils.today()`, `BOOK_OPEN`/`BOOK_CLOSE` are seconds-of-day added to that midnight). The grid must **never** introduce a browser-TZ conversion. See R1.

---

## 1. Branch & commit workflow (per AGENTS.md "New implementation workflow")

1. `git status` → currently on `main`, clean except untracked planning docs. **Confirm with user** whether to branch off (expected: yes). Create:
   `git checkout -b feat/calendar-booking-grid`
2. Commit **per meaningful iteration** (small, reviewable). Suggested sequence maps to §6:
   - `feat(config): add WEEK_START_DAY`
   - `feat(backend): getCalendarGrid emits rectangular month-grid cells`
   - `feat(plan): WarpCalendar grid module + horizontal slider`
   - `refactor(plan): preserve getSelectedDates contract; migrate sessionStorage`
   - `style(plan): overlay panel on desktop, dark theme, responsive grid`
   - `test(e2e): rewrite booking date helpers for grid + add coverage`
   - `docs(i18n): calendar mode keys, drop orphans; update FEATURES/CONFIGURATION`
3. **Before final push:** count `git rev-list --count main..HEAD`; if >1 note the count and ask the user squash vs as-is.
4. **DO NOT execute the final push/PR.** The branch stays local. Stop after the final commit + `graphify update .`; report readiness to the user and hand off for review (step 4). Pushing to remote or opening a PR is explicitly out of scope for the executing agent.

---

## 2. Surface affected (inventory — accurate as of drafting)

### Backend (now in scope — grid range + data is backend-computed)
- `warp/utils.py` — add `getCalendarGrid(today_ts=None)` returning the cell structure + `defaultTs`. `getNextWeek()` (L50) becomes unused by the plan view; **leave it in place** if anything else might use it (grep confirms only `view.py` does) — or delete if truly dead; decide in review.
- `warp/config.py` — add `WEEK_START_DAY` (house convention **0=Monday..6=Sunday**, matching the existing `OMITTED_WEEKDAYS` comment at L23) with default `0` (Monday), and register it in `_ENVSETTINGS` with `_fmt_int`.
- `warp/view.py::plan` (L101) — replace `getNextWeek()` with `getCalendarGrid()`; keep `defaultSelectedDates` derivation (L145–161) but source the default day from the grid's `defaultTs` (preferring selectable days ≥ the `default_day` target, same logic as today). Pass the grid blob to the template.
- `warp/templates/headers/plan.html` — expose the grid blob (and `WEEK_START_DAY` only if the frontend needs it for the header — see §4; the backend can pre-rotate the header so the frontend may not need it) to `window.warpGlobals` alongside `defaultSelectedDates`.

### Plan panel (the checkbox list)
- `warp/templates/plan.html` — `.plan_datelist` block (lines ~152–161) removed; new calendar-grid container; `.plan_datetime_container` restacked to a **column** (calendar on top, slider below). Topcontainer/trigger wiring kept.
- `js/views/plan.js`:
  - `getSelectedDates()` (L38) — rewrite to read the grid's selected set instead of `.date_checkbox`.
  - `initSlider()` (L56) — vertical → **horizontal** (`orientation:'horizontal'`).
  - `initDateSelectorStorage()` (L644) — new sessionStorage schema + migration (R4).
  - `initShiftSelectDates()` (L703) — **removed**; range/multiple selection lives in the calendar module.
  - `DOMContentLoaded` init (L922) — init calendar; wire `onChange` → `updateSeatsView`; default selection from `defaultSelectedDates.cb` / grid `defaultTs`.
  - All `getElementsByClassName('date_checkbox')` listener sites (L38/48, L658/691/708/725/742, L830/838/845/948) — rewired to the calendar's `onChange`.
- `js/base/style.css` — `#plan_sidepanel` (L1022), `.plan_sidepanel_close` (L1031), `.plan_datetime_container` (L1043/1146), `.planmap_datetime_trigger` (L1048), the mobile `@media max-width:993px` block (L1064/1083/1102), `.plan_datelist*` (L1102–1127 — **remove**), `.plan_timeslider*` (L1128–1145 — adapt for horizontal), the desktop-inline/mobile-overlay special-case at **L1896** (revisit: now both are overlays), and new `.plan_calendar*` rules.
- New module: `js/views/modules/calendarGrid.js` (export `WarpCalendar` — see §4).
- `js/views/modules/seat.js`, `js/views/modules/bookas.js`, `js/views/modules/officeMap.js`, `js/base/base.js` — **unchanged**. `base.js` sidenav-trigger handling (L994–1018) reused as-is. `base.js` i18n loading (L234–258) reused; the grid reads `weekdaysShort` and `datePicker.i18n_object.monthsShort` from the loaded `warpGlobals.i18n`.
- `warp/xhr/plan.py::apply` (L317) — **unchanged**; still 403s (code 103) anything outside `getTimeRange()`.

### Report header filters — NOT touched
`js/views/bookings.js` (`dateFilterEditor`, `mergedDateFilterEditor`, Materialize `M.Datepicker`) unchanged. `datePicker.*` i18n keys stay (report uses them). Out of scope.

### i18n (all 5 locales: en/de/es/pl/fr, `warp/static/i18n/*.json`)
- **Reuse** `weekdaysShort` (top-level; used by `base.js` L248/469) for the weekday header — not orphaned.
- **Reuse** `datePicker.i18n_object.monthsShort` (already present in every locale; used by the report's Materialize picker) for the month-name header. No new month key, no duplicated months array (ponytail: avoid a parallel top-level `months` array). Note: this couples the grid to `datePicker.*`; if a cleaner factor-out to a top-level `monthsShort` is later wanted, do it as a separate refactor — out of scope here.
- **Add** ~4 small keys: `calendar.modeSingle`, `calendar.modeMultiple`, `calendar.modeRange`, `calendar.clearSelection` (× 5 locales). Translate in each locale's style — no English fallbacks in non-en locales.
- **Audit & remove orphans** left by the removed checkbox list per §7.

### Docs
- `FEATURES.md` — rewrite §7.5 (booking controls: checkbox list → calendar grid), §7.6 step 1 ("select one or more dates"), §7.7 (shift-select → range/multiple mode), §8 auto-book (wording only), §10 responsive (L666–667 side-panel/sidenav → overlay on both viewports).
- `CONFIGURATION.md` — document `WEEK_START_DAY`; clarify `WEEKS_IN_ADVANCE` / `OMITTED_WEEKDAYS` / `BOOK_OPEN` / `BOOK_CLOSE` now drive the grid's range/greyed cells/selectable days + slider range (semantics unchanged).

### e2e
- **Helpers to rewrite** (`e2e/helpers/booking.ts`): `getFirstZoneDate`, `selectOnlyDates`, and the date-select portion of `bookSeatUI`. **Keep signatures stable** (timestamps in/out, same apply payload) so `apiApply`-based tests and non-date specs are untouched. Grid cells expose `data-ts` and a stable class (e.g. `.warp-cal-day`), which is trivial for Playwright to click/check.
- **UI tests calling the above** and need a pass: `booking/booking.spec.ts`, `booking/fab.spec.ts`, `booking/zone-view-ui.spec.ts`, `booking/zone-group.spec.ts`, `booking/zone-permissions.spec.ts`, `booking/bookas-zone-group.spec.ts`, `booking/zone-permissions-bookas.spec.ts`, `zone-admin/ui.spec.ts`, `bookings-page/zone-map.spec.ts`, plus `helpers/zone-admin.ts`.
- **`apiApply`-based tests are unaffected** (they POST `{fromTS,toTS}` directly, never touching the date UI).
- Suite is **single-worker, shared DB** — read `e2e/README.md` first; import `test`/`expect` from `e2e/fixtures.ts`.
- New coverage in `e2e/tests/booking/calendar.spec.ts`: mode toggle (single/multiple/range) selects correct days; range end-to-end; month-boundary window renders both month blocks; greyed (past/omitted/post-window/padding) cells are not clickable; default-open on desktop viewport / default-closed on mobile viewport; panel hide & reopen via the schedule trigger.

---

## 3. Hard engineering rules (non-negotiable)

- **R1 — No browser-TZ conversions.** The grid's day identity, selection set, and `getSelectedDates()` input are **all integers from the backend's cell `timestamp`s** (UTC-midnight-as-local). The frontend never calls `new Date(ts)` to derive a day label or to round-trip a selection; never uses `getTime()`. The backend computes all date math in Python (`gmtime`/`strftime`), the same functions already producing `getNextWeek`. This makes the TZ trap structurally impossible.
- **R2 — Contract preservation.** `getSelectedDates()` MUST keep returning `[{fromTS,toTS}]` where `fromTS = dayMidnight + slider[0]`, `toTS = dayMidnight + slider[1]` (with the existing `24*3600 → 24*3600-1` clamp). `seat.js` `updateAllStates`, the action-modal "to be booked" table, the apply book/update payload, the auto-book FAB, and `isExactMatch()` are **unchanged**.
- **R3 — Allowed days are server-driven.** Selectable cells = backend's `selectable: true` cells only = today→window-end minus `OMITTED_WEEKDAYS`. Never duplicate the window/omitted logic in JS.
- **R4 — sessionStorage migration.** New schema: `planSelections = { mode:'range', dates:[ts...], slider:[...] }`. On read, if the old `{cb,slider}` shape is present, coerce `cb` → `dates` (intersection with current selectable cells) and drop `cb`; else apply defaults (backend `defaultSelectedDates`). Never crash on a stale/partial blob.
- **R5 — One slider orientation change.** Plan panel slider → `orientation:'horizontal'` below the calendar. The prefs-modal slider (`#pref_timeslider`, `base.js` L297) stays vertical and untouched.
- **R6 — Panel reuse.** Keep `M.Sidenav` + `.sidenav-trigger`/`.sidenav-close` plumbing (`base.js` L994–1018). Desktop-default-open / mobile-default-closed is an init-time `open()` + CSS transform difference, not new overlay machinery.
- **R7 — No abstraction for one use.** `WarpCalendar` wraps exactly one use (the plan panel). Do not build a generic picker framework.
- **R8 — One runnable self-check.** The calendar module leaves one check behind (ponytail): an `init`-time assert that every rendered cell with `data-ts` has a value present in the backend's selectable+greyed set, and that no two cells share a `data-ts`. No framework.
- **R9 — No backend i18n.** The backend grid output is **data only** (ints/flags/enums); it never emits a localized string. All display labels come from the frontend's existing i18n arrays (`weekdaysShort`, `datePicker.i18n_object.monthsShort`). This keeps the existing client-side-only i18n boundary intact — `ical.py` remains the sole documented exception.

---

## 4. Custom grid spec

### 4.1 Backend — `warp/utils.py::getCalendarGrid(today_ts=None)`

Returns a pure-data blob (no strings):

```
{
  weekdayHeader: [0..6],     // 7 indices into the frontend's weekdaysShort array,
                            //   pre-rotated by WEEK_START_DAY (so the frontend renders
                            //   columns in wire order, zero date math).
  months: [
    { year, monthIndex,     // monthIndex 0-11 → frontend maps via monthsShort[monthIndex]
      weeks: [              // each week is exactly 7 cells, ordered to match weekdayHeader
        [ cell, cell, cell, cell, cell, cell, cell ],
        ...
      ]
    },
    ...                     // today's month → month of last selectable window day
  ],
  defaultTs: <int|null>    // the default selectable day (migration of view.py L151–161 logic)
}

cell = {
  timestamp: int|null,      // day-midnight UTC-as-local; null for padding fillers
  day: int|null,             // 1..31 for real days; null for padding
  selectable: bool,          // today..windowEnd AND not OMITTED_WEEKDAYS (and not padding)
  isToday: bool
}
```

Range construction:

#### Bookable span (defines START and END)

What's bookable is **today + the rest of this week + 7*`WEEKS_IN_ADVANCE` full weeks**, minus `OMITTED_WEEKDAYS` — the same boundary `getTimeRange()` (used by `apply`'s code-103 check) already exposes, so the backend's "what's bookable" stays a single source of truth.

- **START** = first bookable day = `today()` (today's midnight).
- **END**   = last bookable day = the **LWD** (last day of a week per `WEEK_START_DAY`, e.g. Sunday when `WEEK_START_DAY=0`/Monday) of the week that is `WEEKS_IN_ADVANCE` full weeks after the current one.
- House weekday (`tm_wday`, 0=Mon..6=Sun): days from today to this week's end = `(6 - today_wday) % 7`; so `END = today_midnight + (((6 - today_wday) % 7) + 7*WEEKS_IN_ADVANCE) * 86400`.

A day is `selectable: true` iff it is **in [START, END]** AND its weekday **is not in `OMITTED_WEEKDAYS`**. Days before START (same-week earlier days, prior weeks), days after END, and `OMITTED_WEEKDAYS` days inside [START, END] all render as **greyed real cells, not hidden**.

#### Grid bounds (always full weeks; always >= one full calendar month)

Two locked rules govern the grid rectangle:

1. **Full weeks (rectangle).** Every grid row is a complete week, FWD (the `WEEK_START_DAY`) -> LWD. The grid is a clean 7-column rectangle; first/last weeks are completed with real greyed cells from the adjacent month (flowing weeks), never blank padding mid-grid. Only the very end of the grid is allowed trailing padding fillers if the grid's last day isn't an LWD.
2. **Always show at least one full calendar month.** The grid must contain some month's 1st-through-last-day (a "full month").
   - If the bookable span START->END already encloses a full calendar month (some month M whose 1st >= START and last day <= END) -> requirement met, no extension: `grid_end = END`.
   - If START->END does **not** enclose any full month -> extend the grid to show the full calendar month END belongs to: `grid_end = last day of END's month`, and (when END's month == START's month) `grid_start = FWD of the week containing the 1st of that month` so the whole month is visible; otherwise `grid_start = FWD of the week containing START`.
- Default `grid_start` (when not pulling back to a month's 1st): **FWD of the week containing START** — the window is week-aligned and forward-looking; days of prior weeks are greyed real cells when they fall inside the selected full month, but no earlier weeks are drawn than needed for rule 1.

#### Month blocks

Weeks flow across month boundaries as continuous 7-cell rows; a week belongs to the month of its first day (a boundary week like Jun 29-Jul 5 renders under June with Jul 1-5 as real greyed/selectable cells). No intra-grid blank padding — only the final week may be trailing-padded to complete a 7-cell row when the grid's last day isn't an LWD.

#### Module / defaultTs / conventions
- **`defaultTs`:** the first `selectable` day >= `target_ts` (the `view.py` default-day derivation — `boundary`/`tomorrow`/`same` — now lives in `view.py` where prefs are loaded; `getCalendarGrid` takes the resolved `target_ts` and scans the cells). `null` if none in range.
- **Conventions:** `WEEK_START_DAY` and `OMITTED_WEEKDAYS` both use the house convention **0=Monday..6=Sunday** (per `config.py` L23 comment); internally convert to whatever `gmtime`/`strftime` `%w` needs. The frontend needs no knowledge of these conventions — it renders `weekdayHeader` and `weeks` in wire order.

### 4.2 Frontend — `js/views/modules/calendarGrid.js`

Export one factory/class `WarpCalendar`:

```
new WarpCalendar(containerEl, {
  grid,                // the backend blob from §4.1
  weekdaysShort,       // from warpGlobals.i18n.weekdaysShort
  monthsShort,        // from warpGlobals.i18n.datePicker.i18n_object.monthsShort
  selected: [ts...],   // initial (from defaultSelectedDates.cb / sessionStorage)
  onChange,            // (selectedTs[]) => void  — drives getSelectedDates + listeners
})
Methods: getSelected() -> ts[]   // no setMode/clear (no mode toggle, no Clear link).
```

Rendering (zero date math — just lay out the blob):
- Weekday header row: `grid.weekdayHeader.map(i => weekdaysShort[i])`.
- For each month in `grid.months`: a month-name header (`monthsShort[monthIndex] + ' ' + year`) then its weeks as rows; each cell shows `cell.day` (or empty for padding), with `data-ts` only on real cells, and classes: `is-selected` / `is-in-range` (range fill) / `is-today` / disabled when `!selectable`.
- Clicks on non-`selectable` cells are ignored. Clicks on selectable cells run the selection logic below and call `onChange`.

Selection model (one behaviour — no mode toggle, no Clear link). The calendar
is additive and range-capable. Maintain `anchor = ts | null` (the last clicked
selectable day):
- **click** → add the day to `selected` (no deselect; re-clicking an already-
  selected day re-anchors it). `anchor = ts`.
- **shift+click** → replace `selected` with every **selectable** ts in
  `[min(anchor, ts) .. max(anchor, ts)]` inclusive over the ascending
  selectable-cell list. The anchor stays the original origin so repeated
  shift-clicks extend from the same start; a 1-day range (start === end) is
  valid and covers the default-day case.
- **drag** → press a selectable cell (anchor) and drag onto another selectable
  cell; the live selection becomes the same contiguous selectable fill as a
  shift-click between anchor and the cell under the pointer, re-evaluated as
  the pointer moves. Release commits the range. Dragging is the ergonomic path
  for multi-day spans; shift-click is the keyboard / accessibility equivalent.

**Range over greyed days (locked).** Range fill spans across greyed (omitted /
post-window / past) days but does NOT select them: `selected` only ever holds
selectable timestamps. So if Wednesday is `OMITTED_WEEKDAYS` and the user
selects Monday → Friday (click Mon, shift-click Fri, or drag Mon→Fri), the
result is `{Mon, Tue, Thu, Fri}` — Wed is crossed but not selected. The
`is-in-range` band is drawn across the span (including the rendered Wed cell)
for visual continuity; the Wed cell stays greyed and unselected. (R3: which
days are selectable is server-driven; the frontend never re-derives it.)

The in-range band highlights only when `selected` is a contiguous run of
selectable days (the shift/drag result); scattered clicks leave endpoints solid
with no band.

Rendering (zero date math — lay out the blob):
- Weekday header row: `grid.weekdayHeader.map(i => weekdaysShort[i])`.
- Month header per block: `monthsShort[monthIndex] + ' ' + year`.
- Each cell shows `cell.day` (empty for padding); real cells carry `data-ts`.
  Classes: `is-selected`, `is-in-range` (span band), `is-today`, `is-disabled`
  when `!selectable` (clicks on disabled cells are ignored — R3).

Mobile-friendliness:
- Cells >= ~44x44px touch target; `touch-action: manipulation` (kill double-tap
  zoom); drag uses pointer events so it works on touch and mouse.
- Inline (not popup) — lives in the side-panel DOM before init.

Mobile-friendliness:
- Cells ≥ ~44×44px touch target; `touch-action: manipulation` (kill double-tap zoom).
- Inline (not popup) — lives in the side-panel DOM before init; no overlay-attach fragility.

---

## 5. Backend changes summary (was "no change" in the prior draft)

| File | Change |
|---|---|
| `warp/utils.py` | Add `getCalendarGrid()` (§4.1). Decide fate of now-unused `getNextWeek` (L50) — delete if confirmed dead, else leave. |
| `warp/config.py` | Add `WEEK_START_DAY = 0` (0=Mon..6=Sun) + register in `_ENVSETTINGS` as `_fmt_int`. |
| `warp/view.py::plan` (L101) | Call `getCalendarGrid()` instead of `getNextWeek()`; keep `defaultSelectedDates` shape (`{slider, cb:[defaultTs]}`) so the frontend default-selection path is unchanged; pass the grid blob to the template. |
| `warp/templates/headers/plan.html` | Expose the grid blob to `window.warpGlobals` (e.g. `warpGlobals.calendarGrid`). |
| `warp/xhr/plan.py::apply` | **Unchanged.** |

---

## 6. Implementation phases (commit-sized)

**Phase A — backend grid**
1. `warp/config.py`: add `WEEK_START_DAY` + `_ENVSETTINGS` entry.
2. `warp/utils.py`: add `getCalendarGrid()` per §4.1.
3. Add a small Python self-check (`tests/test_utils_calendar.py` or an `if __name__`/assert demo): the returned grid's real cells form a contiguous run of day-midnights, each month block is rectangular (every week length 7), no two cells share a `timestamp`, `defaultTs` (when set) is `selectable`. (ponytail: one runnable check, no framework.) Run the existing `tests/` harness too.
4. `view.py::plan`: switch to `getCalendarGrid()`; keep `defaultSelectedDates` shape.
5. `headers/plan.html`: expose the blob.

**Phase B — calendar module**
1. Create `js/views/modules/calendarGrid.js` per §4.2. ≤~200 lines JS.
2. Self-check (R8): every rendered `data-ts` exists in the backend set; no duplicate `data-ts`.
3. Build (`cd js && npm run build` per `webpack.config.js`).

**Phase C — wire into plan panel**
1. `plan.html`: remove `.plan_datelist`; add `<div id="plan_calendar"></div>` + mode-toggle/clear row; restack `.plan_datetime_container` to column (calendar → slider).
2. `plan.js`: init `WarpCalendar` in `DOMContentLoaded`; rewrite `getSelectedDates()` (R1/R2); `initSlider()` → horizontal (R5); replace `initDateSelectorStorage` (R4) and delete `initShiftSelectDates`; rewire all date-change listeners to calendar `onChange`; default `selected` from `defaultSelectedDates.cb`/grid `defaultTs` in range mode.
3. `style.css`: `.plan_calendar*` rules, horizontal `.plan_timeslider`, overlay-on-desktop for `#plan_sidepanel` (R6), revisit the L1896 special-case (now both viewports overlay).

**Phase D — contract verification (no prod code change)**
- Confirm `getSelectedDates()` output shape unchanged via a dev-time assert or an e2e. Remove before merge.

**Phase E — e2e**
1. Rewrite `e2e/helpers/booking.ts` `getFirstZoneDate`/`selectOnlyDates`/`bookSeatUI` date parts to drive grid cells by `data-ts` (range: click start then end; multiple: click each). Keep signatures stable.
2. Add `e2e/tests/booking/calendar.spec.ts`: modes; range end-to-end; month-boundary two-block render; greyed cells unclickable; default-open desktop / default-closed mobile; panel hide & reopen.
3. Run `cd e2e && npm test` (single worker, shared DB).

**Phase F — i18n + docs**
1. Add the ~4 new keys to all 5 `warp/static/i18n/*.json`.
2. Remove orphans found by the audit (§7).
3. Update `FEATURES.md` + `CONFIGURATION.md` per §2.

**Phase G — finalize (no push)**
- `graphify update .` (per AGENTS.md) after code lands.
- `git rev-list --count main..HEAD`; if >1, note the count and ask the user squash vs as-is.
- **Do NOT push to remote or open a PR.** Leave the branch local, report completion, and hand off for step-4 review.

---

## 7. i18n audit procedure (per locale)

For each of `en, de, es, pl, fr` in `warp/static/i18n/*.json`:
1. Build the JS bundle; grep the dist for each key actually referenced (`TR('key')` / `TR('namespace.key')` / array indexing in code).
2. Mark any unreferenced top-level or nested key as a removal candidate. **Confirmed live after this change:** `weekdaysShort` (grid header + `base.js`), `datePicker.*` (grid month names **and** report's Materialize picker — do NOT remove), all `btn.*`, booking action strings.
3. Add: `calendar.modeSingle`, `calendar.modeMultiple`, `calendar.modeRange`, `calendar.clearSelection`. Keep names consistent across locales; translate properly in each. No new weekday/month keys (reused).

---

## 8. Acceptance criteria

- [ ] Grid renders a rectangular whole-month calendar (today's month → month of last selectable day); each month block is a clean padded rectangle (first/last weeks not cut).
- [ ] Non-selectable days (past, omitted, post-window, padding) are **greyed out, not hidden**, and not clickable.
- [ ] Month name shown per month block (`monthsShort` + year).
- [ ] `WEEK_START_DAY` config respected (columns start at the configured day; default Monday).
- [ ] Mode toggle (single/multiple/range) works; default = range with the backend-default day pre-selected (valid 1-day range).
- [ ] Horizontal time slider below the grid; prefs-modal slider unchanged.
- [ ] Panel default-open on desktop, closable, reopenable; default-closed on mobile, opens via the schedule trigger.
- [ ] `getSelectedDates()` output byte-identical in shape to today (`[{fromTS,toTS}]`); seat states, action modal, apply, auto-book behave as before.
- [ ] Booking an allowed day succeeds; a non-selectable day is unclickable (and still 403s code 103 if forced via XHR).
- [ ] Dark + light themes render the grid correctly on both viewports.
- [ ] All 5 i18n locales: new keys present & translated; no orphaned keys; report's `datePicker.*` untouched.
- [ ] Report + My-Bookings filters unchanged (regression check).
- [ ] `FEATURES.md` / `CONFIGURATION.md` updated; `WEEK_START_DAY` documented.
- [ ] `cd e2e && npm test` green (single worker).
- [ ] `graphify update .` run.

## 9. Regression watchlist (priority order)

1. **`getSelectedDates()` shape + TZ** — even with no frontend `Date`, verify a selected day produces the *same* `fromTS` the old checkbox `e.value` would have (R1/R2). Headline win; still confirm.
2. **Backend grid correctness** — rectangularity, padding, `selectable` flags, `defaultTs`, week-start rotation. The new Python self-check (Phase A.3) is the guardrail.
3. **e2e helper rewrite** — subtle selector/sequence errors green nothing.
4. **Layout reflow** — desktop overlay changes map available area; `style.css` L1896 special-case predicated on inline-desktop/overlay-mobile needs revisiting.
5. **sessionStorage migration** — old `planSelections.cb` users must not crash; graceful reset (R4).
6. **Month-boundary rendering** — the edge case this grid exists to handle; verify a window crossing a month end renders two blocks, both month names, correctly aligned weeks, and greyed post-window days through month-end.
7. **No-backend-i18n boundary (R9)** — review that `getCalendarGrid` output contains no strings; all labels come from frontend arrays.
8. **Report untouched** — confirm no accidental coupling (e.g. `datePicker.*` removed — it must stay).

## 10. Open questions for reviewer (step 4)

- Mode-toggle default = Range agreed — confirm Single/Multiple should *not* be default on first load.
- Should `multiple` mode also support shift-click contiguous fill (like the old shift-select), or stay discrete toggles only? Plan keeps it discrete for simplicity.
- Confirm the **month-name header per month block** is the preferred month-boundary treatment (vs. an in-grid month-row or a sidebar label) — the per-block header is chosen for clarity and standard-calendar familiarity.
- Fate of `getNextWeek` (L50) once `getCalendarGrid` supersedes it: delete (confirmed dead — grep shows only `view.py`), or keep for safety? Reviewer to decide.
