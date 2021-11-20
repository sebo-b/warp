"use strict";

/**
 * WarpSeat
 * NOTE: book and assignments from seatData is not cloned, it is stored as reference
 * @param {integer} sid
 * @param {object} seatData - object described in zoneGetSeats
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

        this._createDiv(factory.rootDiv, factory.spriteURL);
    }

    this.action = WarpSeat.SeatStates.NOT_AVAILABLE;
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
    CAN_DELETE_EXACT: 8 // seat is already booked by this user, cannot be changed and selected dated are exactly matching booking dates
}

WarpSeat.Sprites = {
    spriteSize: 48,
    bookOffset: "-144px",
    rebookOffset: "-192px",
    conflictOffset: "-240px",
    userConflictOffset: "-48px",
    userExactOffset: "0px",
    userRebookOffset: "-96px",
    disabledOffset: "-288px",
    bookAssignedOffset: "-336px",
    rebookAssignedOffset: "-384px",
    assignedOffset: "-432px"
};

function WarpSeatFactory(spriteURL,rootDivId,login) {

    this.spriteURL = spriteURL;
    this.rootDiv = document.getElementById(rootDivId);
    this.login = login;
    this.selectedDates = [];

    this.instances = {};
    this.listeners = {
        click: new Set(),
        mouseover: new Set(),
        mouseout: new Set()
    };

    this.myConflictingBookings = new Set();
}

WarpSeatFactory.prototype.getLogin = function() {
    return this.login;
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

 }

// NOTE: seatsData is not cloned
// you have to call updateAllStates after this method
WarpSeatFactory.prototype.setSeatsData = function(seatsData = {}) {

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
};

// NOTE: seatsData is not cloned
// you have to call updateAllStates after this method
WarpSeatFactory.prototype.updateLogin = function(login, seatsData) {

    //delete all other zones seats
    for (let sid in this.instances) {
        if (this.instances[sid].isOtherZone()) {
            this.instances[sid]._destroy();
            delete this.instances[sid]; //according to the spec it is safe to delete property during iteration
        }
    }

    this.login = login;

    //create new seats (all in other zone)
    for (var sid in seatsData.seats) {
        var s = new WarpSeat(sid,seatsData.seats[sid],seatsData.zones,seatsData.users,this);
        this.instances[sid] = s;
    }
}

/**
 * Returns a list of my bookings which conflicts in the given datetime
 * @param raw if true returns an array of bid's
 * @returns array of { sid: 10, bid: 10, fromTS: 1, toTS: 2, zone_name = "Zone 1", seat_name: "Seat 1", datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm" }
 */
 WarpSeatFactory.prototype.getMyConflictingBookings = function(raw = false) {

    var res = [];

    for (var sid of this.myConflictingBookings) {

        var seat = this.instances[sid];

        for (let i of seat._bookingsIterator()) {

            if (!i.book.login == this.login)
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

WarpSeatFactory._formatDatePair = function(b) {

    var fromStr = new Date(b.fromTS*1000).toISOString();
    var toStr = new Date(b.toTS*1000).toISOString();

    if (fromStr.substring(0,10) == toStr.substring(0,10)) {
        return {
            datetime1: fromStr.substring(0,10),
            datetime2: fromStr.substring(11,16)+"-"+toStr.substring(11,16)
        };
    }
    else {
        return {
            datetime1: fromStr.substring(0,16).replace('T',' '),
            datetime2: toStr.substring(0,16).replace('T',' ')
        };
    }
}

WarpSeat.prototype.getState = function() {

    if (this.otherZone)
        throw Error("getState can be called only for seats in the current zone")

    return this.state;
}

WarpSeat.prototype.isOtherZone = function() {
    return this.otherZone;
}

WarpSeat.prototype.getPositionAndSize = function() {

    if (this.otherZone)
        throw Error("getPositionAndSize can be called only for seats in the current zone")

    return {
        x: this.x,
        y: this.y,
        size: WarpSeat.Sprites.spriteSize
     };
}

WarpSeat.prototype.getName = function() {
    return this.name;
}

WarpSeat.prototype.getZoneName = function() {
    return this.zoneName;
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

    if (Object.keys(this.assignments).length > 0 && !(this.factory.login in this.assignments)) {
        this.state = WarpSeat.SeatStates.ASSIGNED;
        return this.state;
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
        this.factory.myConflictingBookings.add(this.sid);
    else
        this.factory.myConflictingBookings.delete(this.sid);

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
    else if (isFree)
        this.state = WarpSeat.SeatStates.CAN_BOOK;
    else
        this.state = WarpSeat.SeatStates.TAKEN;

    return this.state;
}

// as this function relays on myConflictingBookings
// it should be called after all WarpSeats' states are updated
WarpSeat.prototype._updateView = function() {

    // seats form other zones doesn't have divs created
    if (this.otherZone)
        return;

    var assignedToMe = this.factory.login in this.assignments;

    switch (this.state) {

        case WarpSeat.SeatStates.CAN_CHANGE:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.userRebookOffset;
            break;
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.userExactOffset;
            break;
        case WarpSeat.SeatStates.CAN_DELETE:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.userConflictOffset;
            break;
        case WarpSeat.SeatStates.CAN_BOOK:
            if (this.factory.myConflictingBookings.size > 0) {
                this.state = WarpSeat.SeatStates.CAN_REBOOK;    //this is not very elegant
                this.seatDiv.style.backgroundPositionX =
                    assignedToMe ? WarpSeat.Sprites.rebookAssignedOffset : WarpSeat.Sprites.rebookOffset;
            }
            else {
                this.seatDiv.style.backgroundPositionX =
                    assignedToMe ? WarpSeat.Sprites.bookAssignedOffset : WarpSeat.Sprites.bookOffset;
            }
            break;
        case WarpSeat.SeatStates.ASSIGNED:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.assignedOffset;
            if (window.warpGlobals.isZoneAdmin)  // not very elegant
                break;
        case WarpSeat.SeatStates.TAKEN:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.conflictOffset;
        break;
        case WarpSeat.SeatStates.DISABLED:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.disabledOffset;
            break;
        default: /* WarpSeat.SeatStates.NOT_AVAILABLE */
            this.seatDiv.style.backgroundPositionX = WarpSeat.Sprites.disabledOffset;
            break;
    }

    this.seatDiv.style.display = "block";
}

WarpSeat.prototype._destroy = function() {

    this.factory.myConflictingBookings.delete(this.sid);
    this.factory = null;

    if (this.seatDiv) {
        this.seatDiv.removeEventListener('click',this);
        this.seatDiv.removeEventListener('mouseover',this);
        this.seatDiv.removeEventListener('mouseout',this);
        this.seatDiv.remove();
    }
};

WarpSeat.prototype.handleEvent = function(e) {
    if (e.type in this.factory.listeners) {
        for (var l of this.factory.listeners[e.type]) {
            l.call(this);
        }
    }
};

// NOTE: book and assignments from seatData is not cloned, it is stored as reference
WarpSeat.prototype._setData = function(seatData,usersNames) {

    this.name = seatData.name;
    this.book = seatData.book;  //NOTE: just reference

    if (this.otherZone) {
        this.enabled = true;
        this.assignments = {}
        for (let b in this.book) {
            this.book[b].login = this.factory.login;
        }
    }
    else {
        this.enabled = ('enabled' in seatData)? seatData.enabled: true;
        this.assignments = {}

        for (let b in this.book) {
            this.book[b].username = usersNames[this.book[b].login];
        }
        if ('assignments' in seatData) {
            for (let login of seatData.assignments)
                this.assignments[login] = usersNames[login]
        }
    }
}


WarpSeat.prototype._createDiv = function(rootDiv, spriteURL) {

    if (this.seatDiv)
        throw Error("seatDiv already created")

    this.seatDiv =  document.createElement("div");
    this.seatDiv.style.position = "absolute";
    this.seatDiv.style.left = this.x + "px";
    this.seatDiv.style.top = this.y + "px";
    this.seatDiv.style.width = WarpSeat.Sprites.spriteSize + "px";
    this.seatDiv.style.height = WarpSeat.Sprites.spriteSize + "px";
    this.seatDiv.style.backgroundImage = 'url('+spriteURL+')';
    this.seatDiv.style.display = "none";

    this.seatDiv.addEventListener('click',this);
    this.seatDiv.addEventListener('mouseover',this);
    this.seatDiv.addEventListener('mouseout',this);

    rootDiv.appendChild(this.seatDiv);
};

export { WarpSeatFactory, WarpSeat };
