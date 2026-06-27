"use strict";

// WarpCalendar: a lightweight, dependency-free calendar grid renderer for the
// booking (plan) panel. Renders the backend's cell blob (warp.utils.getCalendarGrid)
// as a rectangular padded month-grid (today's month → month of the last
// selectable day) and manages single / multiple / range selection over the
// backend's selectable cells.
//
// This module does ZERO date math (R1): all day identity, weekday alignment,
// month boundaries, selectability and the default day come from the backend
// blob. It never calls new Date(ts) to derive a day label or to round-trip a
// selection; selected days are integer timestamps taken verbatim from the
// backend's cell `timestamp`s. The selection set is a set of ints; getSelected()
// returns them sorted ascending.
//
// R7: this wraps exactly one use (the plan panel). No framework, no generic
// picker abstraction — it renders one grid and one selection model.
//
// Blob contract (see warp.utils.getCalendarGrid):
//   { weekdayHeader:[0..6], months:[{year,monthIndex,weeks:[[cell x7]...]}],
//     defaultTs:int|null }
//   cell = { timestamp:int|null, day:int|null, selectable:bool, isToday:bool }
// `weekdaysShort` and `monthsShort` are the existing frontend i18n arrays:
//   weekdaysShort is indexed 0=Sun..6=Sat (Python's %w) — the backend emits
//   weekdayHeader in that index space, pre-rotated by WEEK_START_DAY.
//   monthsShort is indexed 0=Jan..11=Dec.

const MODES = ['single', 'multiple', 'range'];
const PAD_CELL = { timestamp: null, day: null, selectable: false, isToday: false };

export class WarpCalendar {
    constructor(containerEl, opts) {
        if (!containerEl) throw new Error('WarpCalendar: containerEl required');
        this.container = containerEl;
        this.grid = opts.grid;
        this.weekdaysShort = opts.weekdaysShort;
        this.monthsShort = opts.monthsShort;
        this.mode = (opts.mode && MODES.includes(opts.mode)) ? opts.mode : 'range';
        this.onChange = opts.onChange || (function () {});

        // Build the ascending ts list of selectable cells (range-fill walks this).
        const selectable = [];
        for (let m of this.grid.months)
            for (let week of m.weeks)
                for (let cell of week)
                    if (cell.selectable) selectable.push(cell.timestamp);
        selectable.sort((a, b) => a - b);
        this._selectableTs = selectable;

        // Initial selection (defaultSelectedDates.cb / sessionStorage). Clamp to
        // selectable days — a stale sessionStorage ts that's no longer selectable
        // is silently dropped so it can never enter getSelectedDates()'s payload.
        this.selected = new Set();
        for (let ts of (opts.selected || []))
            if (this._selectableTs.includes(ts)) this.selected.add(ts);

        // range default: a single selected day is a valid 1-day range awaiting the
        // end click; mirror the old shift-select anchor behaviour.
        this.anchor = (this.mode === 'range' && this.selected.size === 1)
            ? [...this.selected][0] : null;

        this._render();
        this._selfCheck();
    }

    setMode(mode) {
        if (!MODES.includes(mode) || mode === this.mode) return;
        this.mode = mode;
        // A lone selected day is a valid single/range start; otherwise drop the
        // pending range anchor (the next click re-seeds it).
        this.anchor = (mode === 'range' && this.selected.size === 1)
            ? [...this.selected][0] : null;
        this._render();
        this.onChange(this.getSelected());
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

        // Pre-compute range fill bounds once (only relevant in range mode with a
        // completed range — anchor === null signals "range completed").
        let rangeLo = null, rangeHi = null;
        if (this.mode === 'range' && this.selected.size > 1 && this.anchor === null) {
            const sel = [...this.selected];
            rangeLo = Math.min(...sel);
            rangeHi = Math.max(...sel);
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
                    row.appendChild(this._renderCell(cell, rangeLo, rangeHi));
                root.appendChild(row);
            }
        }

        this.container.innerHTML = '';
        this.container.appendChild(root);
        this.container.classList.add('warp-calendar');
    }

    _renderCell(cell, rangeLo, rangeHi) {
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
            return c;
        }
        if (this.selected.has(cell.timestamp))
            c.classList.add('is-selected');
        if (rangeLo !== null && cell.timestamp > rangeLo && cell.timestamp < rangeHi)
            c.classList.add('is-in-range');
        c.setAttribute('role', 'button');
        c.setAttribute('tabindex', '0');
        c.addEventListener('click', () => this._onClick(cell.timestamp));
        return c;
    }

    _onClick(ts) {
        if (this.mode === 'single') {
            this.selected = new Set([ts]);
            this.anchor = ts;
        } else if (this.mode === 'multiple') {
            // Discrete toggles only — no shift-fill; see plan §10 (deferred to
            // review). The range mode handles contiguous fill.
            if (this.selected.has(ts)) this.selected.delete(ts);
            else this.selected.add(ts);
            this.anchor = null;
        } else { // range
            if (this.anchor === null) {
                this.selected = new Set([ts]);
                this.anchor = ts;
            } else {
                const lo = Math.min(this.anchor, ts);
                const hi = Math.max(this.anchor, ts);
                this.selected = new Set(
                    this._selectableTs.filter(t => t >= lo && t <= hi));
                this.anchor = null;
            }
        }
        this._render();
        this.onChange(this.getSelected());
    }
}
