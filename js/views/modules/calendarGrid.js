"use strict";

// WarpCalendar: a lightweight, dependency-free calendar grid renderer for the
// booking (plan) panel. Renders the backend's cell blob (warp.utils.getCalendarGrid)
// as a flowing-week grid (FWD->LWD rows; at least one full calendar month —
// see PLAN §4.1) and manages date selection.
//
// Selection model (one behaviour — no mode toggle, no Clear link):
//   click        -> toggle the day (select if absent, deselect if present).
//   shift+click  -> replace the selection with every selectable ts in
//                   [min(anchor,ts) .. max(anchor,ts)] inclusive.
//   drag         -> press a selectable cell (anchor) and drag onto another;
//                   the live selection is the same contiguous selectable fill
//                   between anchor and the cell under the pointer, re-evaluated
//                   as the pointer moves. Release commits. The ergonomic path
//                   for multi-day spans; shift+click is its keyboard equivalent.
//
// Range over greyed days (locked): range fill spans across greyed (omitted /
// past / post-window) days but does NOT select them — `selected` only ever
// holds selectable timestamps. So if Wed is OMITTED and the user selects
// Mon->Fri, the result is {Mon,Tue,Thu,Fri}; Wed is crossed but not selected.
// (R3: which days are selectable is server-driven; the frontend never
// re-derives it. R1: zero date math — day identity is the backend ts.)
//
// Blob contract (see warp.utils.getCalendarGrid):
//   { weekdayHeader:[0..6], months:[{year,monthIndex,weeks:[[cell x7]...]}],
//     defaultTs:int|null }
//   cell = { timestamp:int|null, day:int|null, selectable:bool, isToday:bool }
// weekdaysShort indexed 0=Sun..6=Sat (= %w); weekdayHeader is in that index
// space, pre-rotated by WEEK_START_DAY. monthsShort indexed 0=Jan..11=Dec.

const DRAG_THRESHOLD = 6;   // px — a tap below this stays a click toggle

export class WarpCalendar {
    constructor(containerEl, opts) {
        if (!containerEl) throw new Error('WarpCalendar: containerEl required');
        this.container = containerEl;
        this.grid = opts.grid;
        this.weekdaysShort = opts.weekdaysShort;
        this.monthsShort = opts.monthsShort;
        this.onChange = opts.onChange || (function () {});
        this._fallback = opts.fallback || (this.grid.defaultTs != null ? [this.grid.defaultTs] : []);

        const selectable = [];
        for (let m of this.grid.months)
            for (let week of m.weeks)
                for (let cell of week)
                    if (cell.selectable) selectable.push(cell.timestamp);
        selectable.sort((a, b) => a - b);
        this._selectableTs = selectable;

        // Initial selection (defaultSelectedDates / sessionStorage). Clamp to
        // selectable days; stale ts's are silently dropped. If the clamped set
        // is empty, fall back to the backend default (grid.defaultTs) so a stale
        // sessionStorage never leaves the calendar empty.
        this.selected = new Set();
        const initial = Array.isArray(opts.selected) ? opts.selected : this._fallback;
        for (let ts of initial)
            if (this._selectableTs.includes(ts)) this.selected.add(ts);
        if (this.selected.size === 0)
            for (let ts of this._fallback)
                if (this._selectableTs.includes(ts)) this.selected.add(ts);

        // Anchor for shift-click / drag origin (the last clicked selectable day).
        this.anchor = (this.selected.size === 1) ? [...this.selected][0] : null;

        this._dragState = null;   // {startX,startY,anchor,moved} when pointer is down

        this._render();
        this._selfCheck();
        this._wirePointer();
    }

    getSelected() { return [...this.selected].sort((a, b) => a - b); }

    // R8: every rendered real cell's data-ts exists in the backend real-cell set,
    // the DOM and backend sets match exactly, and no ts is rendered twice.
    _selfCheck() {
        const backendTs = new Set();
        for (let m of this.grid.months)
            for (let week of m.weeks)
                for (let cell of week)
                    if (cell.timestamp !== null) backendTs.add(cell.timestamp);
        const seen = new Set();
        for (let el of this.container.querySelectorAll('[data-ts]')) {
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

    // Fill [lo..hi] with selectable ts's only — greyed/omitted days are crossed
    // but not selected (the locked "range over greyed" rule).
    _rangeFill(min, max) {
        return new Set(this._selectableTs.filter(t => t >= min && t <= max));
    }

    _render() {
        const g = this.grid;
        const root = document.createDocumentFragment();

        const headRow = document.createElement('div');
        headRow.className = 'warp-cal-weekday-row';
        for (let idx of g.weekdayHeader) {
            const c = document.createElement('div');
            c.className = 'warp-cal-weekday';
            c.textContent = this.weekdaysShort[idx];
            headRow.appendChild(c);
        }
        root.appendChild(headRow);

        // A range is just a collection of selected days — every selected day
        // renders with the same solid is-selected shade (no lighter in-range
        // band). Review point 5: "range is always a collection of individual
        // days, even if contiguous" — so interior dates match the endpoints.

        for (let m of g.months) {
            const mhead = document.createElement('div');
            mhead.className = 'warp-cal-month-header';
            mhead.textContent = this.monthsShort[m.monthIndex] + ' ' + m.year;
            root.appendChild(mhead);
            for (let week of m.weeks) {
                const row = document.createElement('div');
                row.className = 'warp-cal-week';
                for (let cell of week)
                    row.appendChild(this._renderCell(cell));
                root.appendChild(row);
            }
        }

        this.container.innerHTML = '';
        this.container.appendChild(root);
        this.container.classList.add('warp-calendar');
    }

    _renderCell(cell) {
        const c = document.createElement('div');
        c.className = 'warp-cal-day';
        if (cell.timestamp === null) { c.classList.add('warp-cal-padded'); return c; }
        c.dataset.ts = String(cell.timestamp);
        c.textContent = String(cell.day);
        if (cell.isToday) c.classList.add('is-today');
        if (!cell.selectable) { c.classList.add('is-disabled'); c.setAttribute('aria-disabled', 'true'); return c; }
        if (this.selected.has(cell.timestamp)) c.classList.add('is-selected');
        c.setAttribute('role', 'button');
        c.setAttribute('tabindex', '0');
        return c;   // pointer listeners are delegated on the container
    }

    _wirePointer() {
        // Pointer capture on the grid so a drag that leaves a cell still tracks.
        this.container.addEventListener('pointerdown', (ev) => this._onDown(ev));
        this.container.addEventListener('pointermove', (ev) => this._onMove(ev));
        this.container.addEventListener('pointerup', (ev) => this._onUp(ev));
        this.container.addEventListener('pointercancel', (ev) => this._onUp(ev, true));
    }

    _cellTsAtPoint(x, y) {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        const cell = el.closest && el.closest('.warp-cal-day[data-ts]');
        if (!cell || cell.classList.contains('is-disabled')) return null;
        return parseInt(cell.dataset.ts, 10);
    }

    _onDown(ev) {
        const ts = this._tsFromEvent(ev);
        if (ts === null) return;
        ev.preventDefault();
        try { this.container.setPointerCapture(ev.pointerId); } catch (e) {}
        // shift+click: range from the existing anchor (no drag). Commits immediately.
        if (ev.shiftKey && this.anchor !== null && this.anchor !== ts) {
            this.selected = this._rangeFill(Math.min(this.anchor, ts), Math.max(this.anchor, ts));
            this._render();
            this.onChange(this.getSelected());
            return;
        }
        // Record the gesture; don't mutate selection yet — a tap is decided on
        // pointerup (toggle), a drag is decided on the first move past threshold.
        this._dragState = {
            ts: ts,
            wasSelected: this.selected.has(ts),
            startX: ev.clientX, startY: ev.clientY,
            anchor: ts, moved: false
        };
    }

    _onMove(ev) {
        if (!this._dragState) return;
        const ds = this._dragState;
        if (!ds.moved) {
            if (Math.abs(ev.clientX - ds.startX) < DRAG_THRESHOLD &&
                Math.abs(ev.clientY - ds.startY) < DRAG_THRESHOLD) return;
            ds.moved = true;
        }
        const ts = this._cellTsAtPoint(ev.clientX, ev.clientY);
        if (ts === null) return;
        this.selected = this._rangeFill(Math.min(ds.anchor, ts), Math.max(ds.anchor, ts));
        this._render();
        this.onChange(this.getSelected());
    }

    _onUp(ev, cancelled) {
        const ds = this._dragState;
        if (!ds) return;
        this._dragState = null;
        if (cancelled || ds.moved) return;   // drag already committed the range
        // Tap (no drag past threshold): toggle the day.
        if (ds.wasSelected) this.selected.delete(ds.ts);
        else { this.selected.add(ds.ts); this.anchor = ds.ts; }
        this._render();
        this.onChange(this.getSelected());
    }

    _tsFromEvent(ev) {
        const el = ev.target.closest && ev.target.closest('.warp-cal-day[data-ts]');
        if (!el || el.classList.contains('is-disabled')) return null;
        return parseInt(el.dataset.ts, 10);
    }
}
