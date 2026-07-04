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

WarpSeat.prototype._updateState = function() {

    if (!this.factory.selectedDates.length) {
        this.state = WarpSeat.SeatStates.NOT_AVAILABLE;
        return this.state;
    }

    if (!this.enabled) {
        this.state = WarpSeat.SeatStates.DISABLED;
        return this.state;
    }

    var assignedButNotForMe = false;
    // Set when a !bookable seat's own-booking CAN_CHANGE is demoted to CAN_DELETE
    // (below): the action becomes release-only, but the icon stays blue "yours"
    // so the user recognises their own booking — the grey "taken" icon would
    // imply someone else's booking / not actionable. Read by spriteFor.
    this.ownReleaseOnly = false;
    // Book-for override of a seat-level assignment (see apply() skipping
    // 106/110 under is_book_for): a zone admin booking FOR a target may book
    // onto a seat assigned to someone else, or beyond the target's
    // days-in-advance window. Only under book-for (factory.login != the real
    // login) and where `bookable` holds — which under book-for already means
    // the actor administers the zone. Self-booking never overrides (106/110
    // apply), so the fall-through is book-for-only. The seat then renders plain
    // green `available` (third-party assignment) or blue `availableAssigned`
    // (assigned to the target, beyond its window).
    const bookForOverride = this.bookable && this.factory.login !== window.warpGlobals.login;

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
                // under is_book_for): fall through to CAN_BOOK (green available).
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

    // Demote action states to their informational equivalent for !bookable
    // seats (view-only zones, or book-for into a zone the actor doesn't
    // administer): occupancy/assignment states are permission-independent,
    // `bookable` only demotes the action states. CAN_REBOOK doesn't exist yet
    // here — it's set in _updateView only for CAN_BOOK, which is already
    // demoted below, so it can never fire for a !bookable seat.
    if (!this.bookable) {
        if (this.state == WarpSeat.SeatStates.CAN_BOOK) {
            this.state = WarpSeat.SeatStates.VIEW_ONLY;
        } else if (this.state == WarpSeat.SeatStates.CAN_CHANGE) {
            // Own booking that could normally be changed (extended/reduced) — in
            // a view-only zone only release is allowed, so demote the action to
            // CAN_DELETE (delete only). Keep the blue "yours" icon (not the grey
            // "taken" one) so the user still recognises their own booking even
            // when the selected time doesn't match exactly.
            this.state = WarpSeat.SeatStates.CAN_DELETE;
            this.ownReleaseOnly = true;
        }
    }

    return this.state;
}

// Map a (final) seat state + assignedToMe flag to a #cell-<name> sprite name
// (PLAN_officemap.md §3). The state must already reflect the CAN_REBOOK /
// VIEW_ONLY side-effects applied in _updateView below.
function spriteFor(state, assignedToMe, ownReleaseOnly) {
    switch (state) {
        case WarpSeat.SeatStates.CAN_BOOK:
            return assignedToMe ? 'availableAssigned' : 'available';
        case WarpSeat.SeatStates.CAN_REBOOK:     return assignedToMe ? 'rebookAssigned'    : 'rebook';
        case WarpSeat.SeatStates.CAN_CHANGE:      return 'yoursChange';
        case WarpSeat.SeatStates.CAN_DELETE_EXACT: return 'yours';
        case WarpSeat.SeatStates.CAN_DELETE:
            // ownReleaseOnly: a view-only-zone own booking demoted from
            // CAN_CHANGE — release-only, but still yours (blue head), not grey
            // "taken".
            if (ownReleaseOnly) return 'yours';
            return 'taken';
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

    switch (this.state) {
        case WarpSeat.SeatStates.CAN_BOOK:
            // !bookable seats never reach _updateView as CAN_BOOK — they were
            // already demoted to VIEW_ONLY at the end of _updateState.
            if (this.factory._conflictCount(this.exclusivityKey) > 0)
                this.state = WarpSeat.SeatStates.CAN_REBOOK;   // conflict map is final here
            break;
        // all other states are already final from _updateState
    }

    this.sprite = spriteFor(this.state, assignedToMe, this.ownReleaseOnly);
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
