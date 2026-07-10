"use strict";

// In-memory key used for the NULL-login (everyone) assignment row.
// Mirror this value in warp/db.py EVERYONE_KEY. Rejected as a user login on the backend.
const EVERYONE_KEY = '__everyone__:550e8400-e29b-41d4-a716-446655440000';

/**
 * WarpSeat
 * NOTE: book and assignments from seatData is not cloned, it is stored as reference
 * @param {integer} sid
 * @param {object} seatData - object described in xhr.plan getSeats
 * @returns
 */
function WarpSeat(sid,seatData,zonesNames,usersNames,factory) {

    this.factory = factory; //this creates a cycle, but afaik GC can manage it

    this.sid = sid;
    this.zoneName = zonesNames[seatData.zid];
    this.otherZone = !('x' in seatData && 'y' in seatData);

    this._setData(seatData,usersNames);

    if (!this.otherZone) {
        this.x = seatData.x;
        this.y = seatData.y;
    }

    this.sprite = 'unavailable';
};

WarpSeat.SeatStates = {
    TAKEN: 0,           // seat is booked by another user
    DISABLED: 1,        // seat is disabled
    ASSIGNED: 2,        // seat is assigned to another user(s)
    NOT_AVAILABLE: 3,   // no dates have been selected
    CAN_BOOK: 4,        // seat is available to be booked
    CAN_REBOOK: 5,      // seat is available to be booked, but other seat is already booked (IMPLEMENTATION NOTE: this state is set in _updateView)
    CAN_CHANGE: 6,      // seat is already booked by this user, but can be changed (extended, reduced, deleted)
    CAN_DELETE: 7,      // seat is already booked by this user, but cannot be changed
    CAN_DELETE_EXACT: 8, // seat is already booked by this user, cannot be changed and selected dated are exactly matching booking dates
    VIEW_ONLY: 9        // bookable-shaped seat in a zone where this user may only view (free, unassigned)
}

WarpSeat.Sprites = {
    spriteSize: 48
};

function WarpSeatFactory(login) {

    this.login = login;
    this.selectedDates = [];

    this.instances = {};
    // click/mouseover/mouseout listeners are invoked with `this === WarpSeat instance` (via handleEvent).
    // setSeatsData/updateAllStates listeners are factory-level and invoked with `this === factory`.
    this.listeners = {
        click: new Set(),
        mouseover: new Set(),
        mouseout: new Set(),
        setSeatsData: new Set(),
        updateAllStates: new Set()
    };

    // Map: exclusivityKey -> Set(sid) of my bookings conflicting with the
    // current selection. Conflicts are scoped per zone-group (or per single
    // zone when ungrouped), mirroring the book_overlap_insert DB trigger, so
    // bookings in unrelated zones of the same plan don't replace each other.
    this.myConflictingBookings = new Map();
    // zid -> zone_group (null = ungrouped), from getSeats.
    this.zoneGroups = {};
}

// Booking-exclusivity key for a zone: shared across a named group, otherwise
// unique per zone. Mirrors book_overlap_insert in schema.sql.
WarpSeatFactory.prototype._exclusivityKey = function(zid) {
    var g = this.zoneGroups[zid];
    return (g !== null && g !== undefined && g !== "") ? ('g:' + g) : ('z:' + zid);
}

WarpSeatFactory.prototype._addConflict = function(key, sid) {
    var s = this.myConflictingBookings.get(key);
    if (!s) { s = new Set(); this.myConflictingBookings.set(key, s); }
    s.add(sid);
}

WarpSeatFactory.prototype._removeConflict = function(key, sid) {
    var s = this.myConflictingBookings.get(key);
    if (s) {
        s.delete(sid);
        if (s.size === 0) this.myConflictingBookings.delete(key);
    }
}

WarpSeatFactory.prototype._conflictCount = function(key) {
    var s = this.myConflictingBookings.get(key);
    return s ? s.size : 0;
}

WarpSeatFactory.prototype.getLogin = function() {
    return this.login;
}

// Switch the "acting" login (book-for). Callers must follow this with a full
// downloadSeatData()/setSeatsData() refresh so every seat — accessible and
// conflict — is rebuilt consistently for the new login. (The old partial
// onlyOtherZone path is gone: it overwrote accessible seats that happened to
// share a conflict zone-group with a div-less ghost, orphaning their sprite.)
WarpSeatFactory.prototype.setLogin = function(login) {
    this.login = login;
}

/**
 * @param {Object[]} selectedDates - list of selected dates [ {from: timestamp, to: timestamp}, ... ]
 */
 WarpSeatFactory.prototype.updateAllStates = function(selectedDates) {

    if (typeof(selectedDates) !== 'undefined') {
        this.selectedDates.length = 0;  //WarpSeats keeps reference to selectedDates, so let's update the array instead of creating a new one
        for (var d of selectedDates) {
            this.selectedDates.push( Object.assign({},d));
        }

        // for efficient iteration selectedDates MUST BE sorted by fromTS
        this.selectedDates.sort((e1,e2) => e1.fromTS - e2.fromTS);  // this could have been done at 'push', but for such a small
                                                                    // array it is not worth it
    }

    for (var seat of Object.values(this.instances)  )
        seat._updateState();

    for (var seat of Object.values(this.instances))
        seat._updateView();

    // Factory-level dispatch: this === factory
    for (var l of this.listeners['updateAllStates']) {
        l.call(this);
    }

 }

// NOTE: seatsData is not cloned
// you have to call updateAllStates after this method
WarpSeatFactory.prototype.setSeatsData = function(seatsData = {}) {

    // Full refresh — replace the zone-group map.
    this.zoneGroups = seatsData.zoneGroups || {};
    // zid -> true if the acting (real, not book-for target) user administers
    // that zone. Used to gate seat-edit per-seat instead of the plan-wide
    // isZoneAdmin flag.
    this.zoneAdmin = seatsData.zoneAdmin || {};

    var oldSeatsIds = new Set( Object.keys(this.instances))

    //create possibly missing seats
    for (var sid in seatsData.seats) {
        if (!oldSeatsIds.delete(sid)) {
            var s = new WarpSeat(sid,seatsData.seats[sid],seatsData.zones,seatsData.users,this);
            this.instances[sid] = s;
        }
        else {
            this.instances[sid]._setData(seatsData.seats[sid],seatsData.users);
        }
    }
    //delete seats which don't exist anymore
    for (var sid of oldSeatsIds) {
        this.instances[sid]._destroy();
        delete this.instances[sid];
    }

    // Factory-level dispatch: this === factory
    for (var l of this.listeners['setSeatsData']) {
        l.call(this);
    }
};

/**
 * Returns the list of my bookings that conflict with the given seat's booking,
 * scoped to that seat's exclusivity group (zone-group, or single zone when
 * ungrouped). Bookings in unrelated zones of the same plan are not included.
 * @param forSeat the WarpSeat being booked/changed
 * @param raw if true returns an array of bid's
 * @returns array of { sid, bid, fromTS, toTS, zone_name, seat_name, datetime1, datetime2 }
 */
 WarpSeatFactory.prototype.getMyConflictingBookings = function(forSeat, raw = false) {

    var res = [];

    var set = forSeat ? this.myConflictingBookings.get(forSeat.exclusivityKey) : null;
    if (!set)
        return res;

    for (var sid of set) {

        var seat = this.instances[sid];

        for (let i of seat._bookingsIterator()) {

            if (i.book.login != this.login)
                continue;

            if (raw) {
                res.push(i.book['bid']);
            }
            else {

                res.push( Object.assign({
                            sid: sid,
                            bid: i.book['bid'],
                            fromTS: i.book['fromTS'],
                            toTS: i.book['toTS'],
                            seat_name: seat.getName(),
                            zone_name: seat.getZoneName(),
                        },
                        WarpSeatFactory._formatDatePair(i.book)));

            }
        }
    }

    return res;
 }

// True if updating forSeat would need to release a conflicting booking that
// lies in a zone the acting admin does not administer. Only relevant under
// book-for: apply() only requires zone-admin to release someone ELSE's
// booking (self-releases are never gated — see apply()'s seatsReqZoneAdmin,
// which excludes Book.login == flask.g.login). Releasing a foreign zone's
// booking would 403 (code 102) and roll back the whole book+remove request,
// so the frontend must not offer that "update" as if it would succeed.
WarpSeatFactory.prototype.hasUnmanageableConflict = function(forSeat) {

    if (this.login === window.warpGlobals.login)
        return false;

    for (var c of this.getMyConflictingBookings(forSeat)) {
        var conflictSeat = this.instances[c.sid];
        if (conflictSeat && !this.zoneAdmin[conflictSeat.zid])
            return true;
    }
    return false;
}

// Plan-wide: used by the auto-book FAB to detect when the current selection is
// already exactly satisfied by an existing booking in any zone.
WarpSeatFactory.prototype.isExactMatch = function() {

    for (var set of this.myConflictingBookings.values()) {
        for (var sid of set) {
            if (this.instances[sid].state === WarpSeat.SeatStates.CAN_DELETE_EXACT)
                return true;
        }
    }
    return false;
}

/**
 * Register callback on all seats
 * @param {string} type - event type, one of click, mouseover, mouseout
 * @param {function} listener
 */
 WarpSeatFactory.prototype.on = function(type,listener) {
    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);
    }
}

/**
 * Unregisters callback, if called without listener unregisters all callbacks for the event
 * @param {*} type - event type, one of click, mouseover, mouseout
 * @param {*} [listener]
 */
 WarpSeatFactory.prototype.off = function(type,listener) {
    if (type in this.listeners) {
        if (listener)
            this.listeners[type].delete(listener);
        else
            this.listeners[type].clear();
    }
}

// Dispatch an event to all registered listeners of `type`, invoking each with
// `thisArg` as `this`. Used to bridge OfficeMap's DOM events (click) to the
// existing factory-listener style (initActionMenu registers via .on('click')).
WarpSeatFactory.prototype._fire = function(type, thisArg) {
    if (!(type in this.listeners)) return;
    for (var l of this.listeners[type]) l.call(thisArg);
}

WarpSeatFactory._formatDatePair = function(b) {
    // Use pre-formatted strings when supplied (cross-plan bookings in a different
    // TZ); otherwise derive from the fake-UTC integer via toISOString().
    var fromStr = b.fromStr || new Date(b.fromTS*1000).toISOString();
    var toStr   = b.toStr   || new Date(b.toTS*1000).toISOString();

    var d = {};
    if (fromStr.substring(0,10) == toStr.substring(0,10)) {
        d.datetime1 = fromStr.substring(0,10);
        d.datetime2 = fromStr.substring(11,16)+"-"+toStr.substring(11,16);
    } else {
        d.datetime1 = fromStr.substring(0,16).replace('T',' ');
        d.datetime2 = toStr.substring(0,16).replace('T',' ');
    }
    if (b.tz) d.datetime2 += ' (' + b.tz + ')';
    return d;
}

WarpSeat.prototype.getState = function() {

    if (this.otherZone)
        throw Error("getState can be called only for seats in the current zone")

    return this.state;
}

WarpSeat.prototype.isOtherZone = function() {
    return this.otherZone;
}

WarpSeat.prototype.getName = function() {
    return this.name;
}

WarpSeat.prototype.getZoneName = function() {
    return this.zoneName;
}

// True if the acting user (the real logged-in admin, not a book-for target)
// administers this seat's zone — the correct per-seat gate for admin-only
// actions (seat-edit), as opposed to the plan-wide isZoneAdmin flag which is
// true if they administer ANY zone on the plan.
WarpSeat.prototype.isMyZoneAdmin = function() {
    return !!this.factory.zoneAdmin[this.zid];
}

// True iff every selected date range is fully contained within one of the
// acting user's OWN bookings on this seat — a "pure shrink" selection: an
// update would only narrow an existing own booking, which is always allowed
// (apply()'s is_pure_shrink bypass, even in view-only / DISABLED zones). Uses
// window.warpGlobals.login (the real actor), not factory.login, so a book-for
// target's booking in a non-administered (!bookable) zone does NOT count —
// changing/releasing it would 403 (release confinement / seatsReqZoneAdmin).
WarpSeat.prototype.isSelectionShrinkOfMine = function() {
    const me = window.warpGlobals.login;
    for (const d of this.factory.selectedDates) {
        let covered = false;
        for (const b of this.book) {
            if (b.login === me && b.fromTS <= d.fromTS && b.toTS >= d.toTS) {
                covered = true;
                break;
            }
        }
        if (!covered) return false;
    }
    return this.factory.selectedDates.length > 0;
};


WarpSeat.prototype.getSid = function() {
    return parseInt(this.sid);  //TODO: convert this.sid to int in constructor
}

WarpSeat.prototype.getAssignments = function() {

    console.assert(!this.otherZone);
    return this.assignments;
}

/**
 * Returns preformatted booking list
 * @returns array { username: "sebo", datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm" }
 *          in case (which should not happen) that reservation is accross days,
 *          datetime{12} will be "yyyy-mm-dd hh:mm"
 */
WarpSeat.prototype.getBookings = function() {

    var res = [];

    for (let i of this._bookingsIterator()) {
        res.push( Object.assign({
                            username: i.book.username
                        },
                        WarpSeatFactory._formatDatePair(i.book)
                    ));
    }

    return res;
}

// Another user's bookings on this seat overlapping the current selection
// (login != the acting user). Used by the plan-view action modal to let a
// zone admin release someone else's booking on a seat they administer
// (apply()'s remove requires per-seat zone-admin for foreign bookings). With
// raw=true returns an array of bid's; otherwise display objects
// {seat_name, zone_name, username, datetime1, datetime2}.
WarpSeat.prototype.getForeignBookings = function(raw) {

    var res = [];

    for (let i of this._bookingsIterator()) {
        if (i.book.login == this.factory.login)
            continue;
        if (raw) {
            res.push(i.book.bid);
        } else {
            res.push( Object.assign({
                        seat_name: this.getName(),
                        zone_name: this.getZoneName(),
                        username: i.book.username,
                    },
                    WarpSeatFactory._formatDatePair(i.book)) );
        }
    }

    return res;
}

/**
 * Iterates over relevant (by given selectedDates) seat bookings
 */
WarpSeat.prototype._bookingsIterator = function*() {

    var bookIdx = 0;

    /* Both dates and bookings collections are:
     * - sorted by fromTS
     * - disjoined
     *
     * so this iteration can be highly optimized,
     * taking only O(m+n)
     */
    for (let date of this.factory.selectedDates) {
        for (; bookIdx < this.book.length; ++bookIdx) {

            let book = this.book[bookIdx];

            if ( book.fromTS >= date.toTS )
                break;
            else if ( book.toTS <= date.fromTS )
                continue;
            else
                yield {book: book, date: date};
        }
    }
}

// Book-for override of seat-level restrictions is in force for this seat:
// the actor is booking FOR someone else and `bookable` holds — which under
// book-for already means the actor administers the zone. Derived on demand
// (never stored) so it can't go stale across _updateState early returns.
WarpSeat.prototype._isBookForOverride = function() {
    return this.bookable && this.factory.login !== window.warpGlobals.login;
}

// True when the seat carries a specific (named) assignment to someone other
// than the book-for target (factory.login). An everyone-only assignment is not
// "to another person" — it includes the target.
WarpSeat.prototype._isAssignedToOther = function() {
    return Object.keys(this.assignments).some(k => k !== EVERYONE_KEY && k !== this.factory.login);
}

WarpSeat.prototype._updateState = function() {

    if (!this.factory.selectedDates.length) {
        this.state = WarpSeat.SeatStates.NOT_AVAILABLE;
        return this.state;
    }

    // Book-for override of seat-level restrictions (see apply() skipping
    // 105/106/110 under is_book_for): a zone admin booking FOR a target may
    // book onto a seat assigned to someone else, beyond the target's
    // days-in-advance window, OR a seat the admin has disabled — so under
    // book-for a disabled seat does NOT take the DISABLED early return; it
    // runs the normal pipeline (CAN_BOOK / CAN_REBOOK / CAN_CHANGE / CAN_DELETE_*)
    // so the click handler offers the right action (book, update when the target
    // has a conflicting booking in the zone group, release when the target
    // already holds it). Only under book-for (factory.login != the real login)
    // and where `bookable` holds — which under book-for already means the actor
    // administers the zone. Self-booking never overrides (105/106/110 apply).
    // The disabled ICON is kept as a visual cue: _updateView forces the sprite
    // to 'unavailable' for a disabled seat under book-for (the state still
    // drives the actions; the icon just signals "this seat is off").
    const bookForOverride = this._isBookForOverride();

    if (!this.enabled && !bookForOverride) {
        this.state = WarpSeat.SeatStates.DISABLED;
        return this.state;
    }

    var assignedButNotForMe = false;
    // (bookForOverride is hoisted above — see the comment near the !this.enabled
    // check.) Under book-for a seat assigned to someone else, or beyond the
    // target's days-in-advance window, falls through to CAN_BOOK: a third-party
    // assignment renders with the `assigned` icon (see _updateView's book-for
    // override), a target assignment renders `availableAssigned` (blue, below).

    if (Object.keys(this.assignments).length > 0) {

        const everyoneData = this.assignments[EVERYONE_KEY];
        const hasEveryone = everyoneData !== undefined;
        const userAssignment = this.assignments[this.factory.login];
        const hasUserAssignment = userAssignment !== undefined;
        const hasSpecificAssignment = Object.keys(this.assignments).some(k => k !== EVERYONE_KEY);

        if (!this.bookable) {
            // Under book-for/viewer access, a specific-login assignment (anyone's,
            // including this acting user's own) is informational only — it never
            // grants booking rights here, so any named assignee marks the seat as
            // assigned to someone. An everyone-only assignment names no one, so it
            // carries no information for a non-booker and is ignored (falls through
            // to occupancy, i.e. CAN_BOOK below, later demoted to VIEW_ONLY).
            if (hasSpecificAssignment) {
                assignedButNotForMe = true;
            }
        } else if (hasUserAssignment || hasEveryone) {
            // Compute most-permissive days_in_advance across user's own row and everyone row
            let bestDays;
            if (hasUserAssignment) {
                bestDays = userAssignment.days_in_advance; // null (unlimited) or integer
            }
            if (hasEveryone) {
                const evDays = everyoneData.days_in_advance;
                if (bestDays === undefined) {
                    bestDays = evDays;
                } else if (evDays === null || bestDays === null) {
                    bestDays = null; // null wins (unlimited)
                } else {
                    bestDays = Math.max(bestDays, evDays);
                }
            }
            if (bestDays !== null && bestDays !== undefined) {
                // server-anchored: service timezone may differ from the client's
                var cutoffTs = window.warpGlobals.today + (bestDays + 1) * 24 * 3600;
                if (this.factory.selectedDates.some(d => d.fromTS >= cutoffTs)) {
                    if (bookForOverride) {
                        // Book-for overrides the days-in-advance window
                        // (apply() skips 110 under is_book_for): fall through
                        // to CAN_BOOK (green available / availableAssigned).
                    } else {
                        this.state = WarpSeat.SeatStates.ASSIGNED;
                        return this.state;
                    }
                }
            }
            // dates are within window — fall through to booking state
        } else {
            // Specific assignment(s) exist, but not for this user and no everyone row.
            if (bookForOverride) {
                // Book-for overrides the assignment check (apply() skips 106
                // under is_book_for): fall through to CAN_BOOK; the seat renders
                // with the `assigned` icon (see _updateView's book-for override).
            } else {
                // The seat is effectively assigned to others; still show as booked if it is.
                assignedButNotForMe = true;
            }
        }
    }

    var bookings = this.book;

    var isFree = true;
    var isMine = false;
    var isExact = 0;

    for (var i of this._bookingsIterator()) {

        if (i.book.login == this.factory.login) {

            isMine = true;

            if (i.book.fromTS == i.date.fromTS && i.book.toTS == i.date.toTS)
                ++isExact;

            if (!isFree)
                break;
        }
        else {
            isFree = false;
            if (isMine)
                break;
        }
    }

    if (isMine)
        this.factory._addConflict(this.exclusivityKey, this.sid);
    else
        this.factory._removeConflict(this.exclusivityKey, this.sid);

    if (this.otherZone) {
        this.state = WarpSeat.SeatStates.DISABLED;
        return this.state;
    }

    if (isMine) {

        if (isExact == this.factory.selectedDates.length)
            this.state = WarpSeat.SeatStates.CAN_DELETE_EXACT;
        else if (isFree)
            this.state = WarpSeat.SeatStates.CAN_CHANGE;
        else
            this.state = WarpSeat.SeatStates.CAN_DELETE;

    }
    else if (isFree) {
        if (assignedButNotForMe) {
            this.state = WarpSeat.SeatStates.ASSIGNED;
        }
        else {
            this.state = WarpSeat.SeatStates.CAN_BOOK;
        }
    }
    else
        this.state = WarpSeat.SeatStates.TAKEN;

    // Demote the one action state for !bookable seats (view-only zones, or
    // book-for into a zone the actor doesn't administer): occupancy/assignment
    // states are permission-independent, `bookable` only demotes CAN_BOOK.
    // CAN_CHANGE (own booking, non-exact) is NOT demoted — a pure shrink is
    // always allowed (apply()'s is_pure_shrink bypass + plan.js
    // isSelectionShrinkOfMine), so the blue "yoursChange" icon and the Update
    // action stay even in a view-only zone. CAN_REBOOK doesn't exist yet here
    // — it's set in _updateView only for CAN_BOOK, which is already demoted
    // below, so it can never fire for a !bookable seat.
    if (!this.bookable && this.state == WarpSeat.SeatStates.CAN_BOOK) {
        this.state = WarpSeat.SeatStates.VIEW_ONLY;
    }

    return this.state;
}

// Map a (final) seat state + assignedToMe flag to a #cell-<name> sprite name
// (PLAN_officemap.md §3). The state must already reflect the CAN_REBOOK /
// VIEW_ONLY side-effects applied in _updateView below.
function spriteFor(state, assignedToMe) {
    switch (state) {
        case WarpSeat.SeatStates.CAN_BOOK:
            return assignedToMe ? 'availableAssigned' : 'available';
        case WarpSeat.SeatStates.CAN_REBOOK:     return assignedToMe ? 'rebookAssigned'    : 'rebook';
        case WarpSeat.SeatStates.CAN_CHANGE:      return 'yoursChange';
        case WarpSeat.SeatStates.CAN_DELETE_EXACT: return 'yours';
        case WarpSeat.SeatStates.CAN_DELETE:      return 'taken';
        case WarpSeat.SeatStates.TAKEN:            return 'taken';
        case WarpSeat.SeatStates.ASSIGNED:        return 'assigned';
        case WarpSeat.SeatStates.VIEW_ONLY:
        case WarpSeat.SeatStates.DISABLED:
        case WarpSeat.SeatStates.NOT_AVAILABLE:     return 'unavailable';
    }
    return 'unavailable';
}

// Computes the final presentational state (applying the CAN_REBOOK / VIEW_ONLY
// side-effects that depend on the factory-wide conflict map, which is only
// complete after every seat's _updateState has run) and stores the sprite name.
// No DOM here — OfficeMap owns the seat DOM (PLAN §1, §7).
WarpSeat.prototype._updateView = function() {

    if (this.otherZone)
        return;

    var assignedToMe = this.factory.login in this.assignments;

    var wasCanBook = this.state === WarpSeat.SeatStates.CAN_BOOK;

    switch (this.state) {
        case WarpSeat.SeatStates.CAN_BOOK:
            // !bookable seats never reach _updateView as CAN_BOOK — they were
            // already demoted to VIEW_ONLY at the end of _updateState.
            if (this.factory._conflictCount(this.exclusivityKey) > 0)
                this.state = WarpSeat.SeatStates.CAN_REBOOK;   // conflict map is final here
            break;
        // all other states are already final from _updateState
    }

    this.sprite = spriteFor(this.state, assignedToMe);

    // Book-for override of a seat-level disable: the disabled seat ran the
    // normal pipeline (so its state drives the click actions — book / update /
    // release) but the ICON stays the grey "unavailable" X as a visual cue that
    // the seat is off. Only under book-for in an administered zone. (With no
    // dates selected the state is NOT_AVAILABLE, whose sprite is already
    // 'unavailable', so deriving the override here is safe for every state.)
    if (!this.enabled && this._isBookForOverride())
        this.sprite = 'unavailable';
    // Book-for of a seat assigned to someone other than the target: the seat is
    // still bookable (the admin may book it for anyone — see the bookForOverride
    // fall-throughs in _updateState), but it keeps the "assigned" icon instead
    // of the plain "+" so the assignment stays visible. Only when the seat ended
    // up bookable (CAN_BOOK / the CAN_REBOOK that derives from it).
    else if (this._isBookForOverride() && wasCanBook && this._isAssignedToOther())
        this.sprite = 'assigned';
}

WarpSeat.prototype._destroy = function() {
    this.factory._removeConflict(this.exclusivityKey, this.sid);
    this.factory = null;
    // No seat DOM here — OfficeMap owns it. When the seat set changes, plan.js
    // rebuilds the whole OfficeMap seat set via createSeats(), which drops the
    // old seat elements.
};

// NOTE: book and assignments from seatData is not cloned, it is stored as reference
WarpSeat.prototype._setData = function(seatData,usersNames) {

    this.name = seatData.name;
    this.book = seatData.book;  //NOTE: just reference

    this.zid = seatData.zid;
    this.exclusivityKey = this.factory._exclusivityKey(seatData.zid);

    if (this.otherZone) {
        this.enabled = true;
        this.bookable = false;
        this.assignments = {}
        // book[].login comes from the server (getSeats conflict query selects it);
        // no client-side back-fill from factory.login is needed.
    }
    else {
        this.enabled = ('enabled' in seatData)? seatData.enabled: true;
        this.bookable = ('bookable' in seatData)? seatData.bookable: true;
        this.assignments = {}

        for (let b in this.book) {
            this.book[b].username = usersNames[this.book[b].login];
        }
        if ('assignments' in seatData) {
            for (let a of seatData.assignments) {
                if (a.isEveryone) {
                    this.assignments[EVERYONE_KEY] = { name: TR('Everyone'), days_in_advance: a.days_in_advance ?? null, isEveryone: true };
                } else {
                    this.assignments[a.login] = { name: usersNames[a.login] ?? a.login, days_in_advance: a.days_in_advance ?? null };
                }
            }
        }
    }
}



export { WarpSeatFactory, WarpSeat, EVERYONE_KEY };
