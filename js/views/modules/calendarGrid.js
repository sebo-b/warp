"use strict";

// WarpCalendar: a lightweight, dependency-free calendar grid renderer for the
// booking (plan) panel. Renders the backend's cell blob (warp.utils.getCalendarGrid)
// as a rectangular padded month-grid (today's month → month of the last
// selectable day) and manages date selection.
//
// Selection model (one behaviour — no mode toggle):
//   click        → add the day to the selection (no deselect: clicking an
//                  already-selected day is a no-op; the Clear link is the only
//                  way to empty the selection). The clicked day becomes the
//                  shift-range anchor.
//   shift+click  → replace the selection with the contiguous selectable run
//                  [anchor .. clicked] (inclusive). Anchor stays the original
//                  start so repeated shift-clicks extend from the same origin.
//
// R1: zero date math — all day identity, weekday alignment, month boundaries,
// selectability and the default day come from the backend blob; selected days
// are integer timestamps taken verbatim from the backend cell `timestamp`s.
// Never calls new Date(ts) to derive a day label or to round-trip a selection.
//
// R8 self-check at init: every rendered real cell's data-ts exists in the
// backend real-cell set (and vice-versa), with no duplicate ts rendered.
// R7: wraps exactly one use (the plan panel) — no picker framework.
//
// Blob contract (see warp.utils.getCalendarGrid):
//   { weekdayHeader:[0..6], months:[{year,monthIndex,weeks:[[cell x7]...]}],
//     defaultTs:int|null }
//   cell = { timestamp:int|null, day:int|null, selectable:bool, isToday:bool }
// `weekdaysShort` indexed 0=Sun..6=Sat (Python's %w); weekdayHeader is in that
// index space, pre-rotated by WEEK_START_DAY. monthsShort indexed 0=Jan..11=Dec.

export class WarpCalendar {
    constructor(containerEl, opts) {
        if (!containerEl) throw new Error('WarpCalendar: containerEl required');
        this.container = containerEl;
        this.grid = opts.grid;
        this.weekdaysShort = opts.weekdaysShort;
        this.monthsShort = opts.monthsShort;
        this.onChange = opts.onChange || (function () {});

        // Ascending ts list of selectable cells — shift-range fill walks this.
        const selectable = [];
        for (let m of this.grid.months)
            for (let week of m.weeks)
                for (let cell of week)
                    if (cell.selectable) selectable.push(cell.timestamp);
        selectable.sort((a, b) => a - b);
        this._selectableTs = selectable;

        // Initial selection (defaultSelectedDates / sessionStorage). Clamp to
        // selectable days — a stale ts that's no longer selectable is silently
        // dropped so it can never enter getSelectedDates()'s payload.
        this.selected = new Set();
        for (let ts of (opts.selected || []))
            if (this._selectableTs.includes(ts)) this.selected.add(ts);

        // Anchor for shift-range: the last day the user clicked. Seed from the
        // lone initial selection so a shift-click right after load ranges from
        // the default day (same UX the old shift-select seeded).
        this.anchor = (this.selected.size === 1) ? [...this.selected][0] : null;

        this._render();
        this._selfCheck();
    }

    clear() {
        this.selected.clear();
        this.anchor = null;
        this._render();
        this.onChange(this.getSelected());
    }

    getSelected() { return [...this.selected].sort((a, b) => a - b); }

    // R8: one runnable check — every rendered data-ts exists in the backend's
    // real-cell set, the DOM and backend sets match exactly, and no ts is
    // rendered twice. No framework.
    _selfCheck() {
        const backendTs = new Set();
        for (let m of this.grid.months)
            for (let week of m.weeks)
                for (let cell of week)
                    if (cell.timestamp !== null) backendTs.add(cell.timestamp);

        const seen = new Set();
        const dom = this.container.querySelectorAll('[data-ts]');
        for (let el of dom) {
            const ts = parseInt(el.dataset.ts, 10);
            if (!backendTs.has(ts))
                throw new Error('WarpCalendar: data-ts ' + ts + ' not in backend grid');
            if (seen.has(ts))
                throw new Error('WarpCalendar: duplicate data-ts ' + ts);
            seen.add(ts);
        }
        for (let ts of backendTs)
            if (!seen.has(ts))
                throw new Error('WarpCalendar: backend ts ' + ts + ' not rendered');
    }

    _render() {
        const g = this.grid;
        const root = document.createDocumentFragment();

        // Weekday header row — renders in wire order (weekdayHeader already
        // pre-rotated by WEEK_START_DAY) so the frontend needs no date math.
        const headRow = document.createElement('div');
        headRow.className = 'warp-cal-weekday-row';
        for (let idx of g.weekdayHeader) {
            const c = document.createElement('div');
            c.className = 'warp-cal-weekday';
            c.textContent = this.weekdaysShort[idx];
            headRow.appendChild(c);
        }
        root.appendChild(headRow);

        // Range-band bounds for the in-range highlight: only when the selection
        // is a contiguous run of >1 (a shift-range result). Endpoints get the
        // strong is-selected shade; the interior gets the lighter is-in-range band.
        let lo = null, hi = null;
        if (this.selected.size > 1) {
            const sel = [...this.selected];
            lo = Math.min(...sel);
            hi = Math.max(...sel);
            // contiguous check: every selectable ts in [lo..hi] must be selected,
            // otherwise don't band (the user clicked scattered days).
            for (let t of this._selectableTs)
                if (t > lo && t < hi && !this.selected.has(t)) { lo = null; hi = null; break; }
        }

        for (let m of g.months) {
            const mhead = document.createElement('div');
            mhead.className = 'warp-cal-month-header';
            mhead.textContent = this.monthsShort[m.monthIndex] + ' ' + m.year;
            root.appendChild(mhead);

            for (let week of m.weeks) {
                const row = document.createElement('div');
                row.className = 'warp-cal-week';
                for (let cell of week)
                    row.appendChild(this._renderCell(cell, lo, hi));
                root.appendChild(row);
            }
        }

        this.container.innerHTML = '';
        this.container.appendChild(root);
        this.container.classList.add('warp-calendar');
    }

    _renderCell(cell, lo, hi) {
        const c = document.createElement('div');
        c.className = 'warp-cal-day';
        if (cell.timestamp === null) {
            c.classList.add('warp-cal-padded');
            return c;
        }
        c.dataset.ts = String(cell.timestamp);
        c.textContent = String(cell.day);
        if (cell.isToday) c.classList.add('is-today');
        if (!cell.selectable) {
            c.classList.add('is-disabled');
            c.setAttribute('aria-disabled', 'true');
            return c;   // R3: selectable is server-driven; disabled cells are inert
        }
        const sel = this.selected.has(cell.timestamp);
        if (sel) c.classList.add('is-selected');
        if (lo !== null && cell.timestamp > lo && cell.timestamp < hi)
            c.classList.add('is-in-range');
        c.setAttribute('role', 'button');
        c.setAttribute('tabindex', '0');
        c.addEventListener('click', (ev) => this._onClick(cell.timestamp, ev.shiftKey));
        return c;
    }

    _onClick(ts, shiftKey) {
        if (shiftKey && this.anchor !== null) {
            // Replace with the contiguous selectable run [anchor .. ts].
            const lo = Math.min(this.anchor, ts);
            const hi = Math.max(this.anchor, ts);
            this.selected = new Set(
                this._selectableTs.filter(t => t >= lo && t <= hi));
            // Keep the anchor so a further shift-click extends from the same origin.
        } else {
            // Click to select (no deselect: idempotent if already selected).
            this.selected.add(ts);
            this.anchor = ts;
        }
        this._render();
        this.onChange(this.getSelected());
    }
}
