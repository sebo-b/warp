"use strict";

/**
 * WarpSeat
 * NOTE: book from seatData is not cloned, it is stored as reference
 * @param {integer} sid 
 * @param {object} seatData - object described in zoneGetSeats
 * @returns 
 */
function WarpSeat(sid,seatData,factory) {

    // reference to some factory properties
    // we don't want to reference whole factory to not create circular references
    // between WarpSeat and WarpSeatFactory
    this.listeners = factory.listeners;
    this.selectedDates = factory.selectedDates;
    this.myConflictingBookings = factory.myConflictingBookings;

    this._setData(seatData);

    this.sid = sid;
    this.x = seatData.x;
    this.y = seatData.y;
    this.zid = seatData.zid;


    if (this.zid == factory.zoneData['id']) {
        this._createDiv(factory.rootDiv, factory.spriteURL);
    }
    
    this.action = WarpSeat.SeatStates.NOT_AVAILABLE;
};

WarpSeat.SeatStates = {
    TAKEN: 0,           // seat is booked by another user
    DISABLED: 1,        // seat is disabled
    NOT_AVAILABLE: 2,   // no dates have been selected
    CAN_BOOK: 3,        // seat is available to be booked
    CAN_REBOOK: 4,      // seat is available to be booked, but other seat is already booked (IMPLEMENTATION NOTE: this state is set in _updateView)
    CAN_CHANGE: 5,      // seat is already booked by this user, but can be changed (extended, reduced, deleted)
    CAN_DELETE: 6,      // seat is already booked by this user, but cannot be changed
    CAN_DELETE_EXACT: 7 // seat is already booked by this user, cannot be changed and selected dated are exactly matching booking dates
}

WarpSeat.Defines = {
    spriteSize: 48,
    spriteBookOffset: "-144px",
    spriteRebookOffset: "-192px",
    spriteConflictOffset: "-240px",
    spriteUserConflictOffset: "-48px",
    spriteUserExactOffset: "0px",
    spriteUserRebookOffset: "-96px",
    spriteDisabledOffset: "-288px"
};

function WarpSeatFactory(spriteURL,rootDivId,zoneData) {

    this.spriteURL = spriteURL;
    this.rootDiv = document.getElementById(rootDivId);
    this.selectedDates = [];
    this.zoneData = zoneData;

    this.instances = {};
    this.listeners = {
        click: new Set(), 
        mouseover: new Set(), 
        mouseout: new Set()
    };

    this.myConflictingBookings = new Set();
}

/**
 * @param {Object[]} selectedDates - list of selected dates [ {from: timestamp, to: timestamp}, ... ]
 */
 WarpSeatFactory.prototype.updateAllStates = function(selectedDates) {

    if (typeof(selectedDates) !== 'undefined') {
        this.selectedDates.length = 0;  //WarpSeats keep reference to selectedDates
        for (var d of selectedDates) {
            this.selectedDates.push( Object.assign({},d));
        }
    }

    for (var seat of Object.values(this.instances)  )
        seat._updateState();

    for (var seat of Object.values(this.instances))
        seat._updateView();

 }


// NOTE: seatsData is not cloned
WarpSeatFactory.prototype.setSeatsData = function(seatsData = {}) {

    var oldSeatsIds = new Set( Object.keys(this.instances))

    //create possibly missing seats
    for (var sid in seatsData) {
        if (!oldSeatsIds.delete(sid)) {
            var s = new WarpSeat(sid,seatsData[sid],this);
            this.instances[sid] = s;
        }
        else {
            this.instances[sid]._setData(seatsData[sid]);
        }
    }
    //delete seats which don't exist anymore
    for (var sid of oldSeatsIds) {
        this.instances[sid]._destroy();
        delete this.instances[sid];
    }
};

/**
 * Returns raw list of my bookings which conflicts in the given datetime
 * @returns array of { sid: 10, bid: 10, fromTS: 1, toTS: 2 }
 */
 WarpSeatFactory.prototype.getMyConflictingBookingsRaw = function() {

    var res = [];

    for (var sid of this.myConflictingBookings) {
        var seat = this.instances[sid];

        date_loop:
        for (var date of this.selectedDates) {
            for (var book of seat.book) {
                if ( book.fromTS >= date.toTS ) // book is sorted by fromTS, so we can optimize
                    break;
                else if (book.toTS > date.fromTS) {
                    res.push( {
                        sid: sid,
                        bid: book['bid'],
                        fromTS: book['fromTS'],
                        toTS: book['toTS']
                    });
                }
            }
        }    
    }

    return res;    
}

/**
 * Returns formatted list of my bookings which conflicts in the given datetime
 * @returns array from getMyConflictingBookingsRaw extended with { zone_name = "Zone 1", seat_name: "Seat 1", datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm" }
 */
 WarpSeatFactory.prototype.getMyConflictingBookings = function() {

    var bookings = this.getMyConflictingBookingsRaw();

    for (let b of bookings) {
        
        var seatName = this.instances[b.sid].getName();
        var zid = this.instances[b.sid].getZid();

        Object.assign(b, {
                seat_name: seatName,
                zone_name: this.zoneData.names[zid]},  
            WarpSeatFactory._formatDatePair(b));
    }

    return bookings;
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
    return this.state;
}

WarpSeat.prototype.getPositionAndSize = function() {
    return { 
        x: this.x, 
        y: this.y,
        size: WarpSeat.Defines.spriteSize
     };
}

WarpSeat.prototype.getName = function() {   
    return this.name;
}

WarpSeat.prototype.getSid = function() {   
    return parseInt(this.sid);  //TODO: convert this.sid to int in constructor
}

WarpSeat.prototype.getZid = function() {   
    return parseInt(this.zid);  //TODO: convert this.sid to int in constructor
}


WarpSeat.prototype.getAllBookings = function() {
    return this.book;
}

/**
 * Returns raw booking list
 * @returns array of { bid: 10, username: "sebo", isMine: true, fromTS: 1, toTS: 2 }
 */
WarpSeat.prototype.getBookingsRaw = function() {

    var bookings = this.getAllBookings();
    var selectedDates = this.selectedDates;

    var res = [];

    date_loop:
    for (var date of selectedDates) {
        for (var book of bookings) {
            if ( book.fromTS >= date.toTS ) // book is sorted by fromTS, so we can optimize
                break;
            else if (book.toTS > date.fromTS) {
                res.push( Object.assign({}, book));
            }
        }
    }

    return res;    
}

/**
 * Returns preformatted booking list
 * @returns array from getBookingsRaw extended with { datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm" }
 *          in case (which should not happen) that reservation is accross days, 
 *          datetime{12} will be "yyyy-mm-dd hh:mm"
 */
WarpSeat.prototype.getBookings = function() {

    var bookings = this.getBookingsRaw();

    for (var b of bookings) {
        Object.assign(b, WarpSeatFactory._formatDatePair(b));
    }

    return bookings;
}

WarpSeat.prototype._updateState = function() {

    var selectedDates = this.selectedDates;

    if (!selectedDates.length) {
        this.state = WarpSeat.SeatStates.NOT_AVAILABLE;
        return this.state;
    }

    if (!this.enabled) {
        this.state = WarpSeat.SeatStates.DISABLED;
        return this.state;
    }

    var bookings = this.getAllBookings();

    var isFree = true;
    var isMine = false;
    var isExact = 0;

    date_loop:
    for (var date of selectedDates) {

        for (var book of bookings) {

            if ( book.fromTS >= date.toTS ) { // book is sorted by fromTS, so we can optimize here
                break;
            }
            else if (book.toTS > date.fromTS) {

                if (book.isMine) {

                    isMine = true;

                    if (book.fromTS == date.fromTS && book.toTS == date.toTS)
                        ++isExact;

                    if (!isFree)
                        break date_loop;
                }
                else {
                    isFree = false;
                    if (isMine)
                        break date_loop;
                }
            }
        }
    }

    if (isMine)
        this.myConflictingBookings.add(this.sid);
    else
        this.myConflictingBookings.delete(this.sid);

    if (isMine) {

        if (isExact == selectedDates.length)
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
    if (!this.seatDiv)
        return;

    switch (this.state) {

        case WarpSeat.SeatStates.CAN_CHANGE:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteUserRebookOffset;
            break;
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteUserExactOffset;
            break;
        case WarpSeat.SeatStates.CAN_DELETE:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteUserConflictOffset;
            break;
        case WarpSeat.SeatStates.CAN_BOOK:   
            if (this.myConflictingBookings.size > 0) {
                this.state = WarpSeat.SeatStates.CAN_REBOOK;    //this is not very elegant
                this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteRebookOffset;
            }
            else
                this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteBookOffset;
            break;
        case WarpSeat.SeatStates.TAKEN:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteConflictOffset;
            break;
        case WarpSeat.SeatStates.DISABLED:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteDisabledOffset;
            break;
        default: /* WarpSeat.SeatStates.NOT_AVAILABLE */
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteDisabledOffset;
            break;
    }

    this.seatDiv.style.display = "block";
}

WarpSeat.prototype._destroy = function() {

    this.myConflictingBookings.delete(this.sid);

    // dereference factory objects
    this.listeners = null;
    this.selectedDates = null;
    this.myConflictingBookings = null;

    if (this.seatDiv) {
        this.seatDiv.removeEventListener('click',this);
        this.seatDiv.removeEventListener('mouseover',this);
        this.seatDiv.removeEventListener('mouseout',this);
        this.seatDiv.remove();    
    }
};

WarpSeat.prototype.handleEvent = function(e) {
    if (e.type in this.listeners) {
        for (var l of this.listeners[e.type]) {
            l.call(this);
        }
    }
};

// NOTE: book from seatData is not cloned, it is stored as reference
WarpSeat.prototype._setData = function(seatData) {

    this.name = seatData.name;
    this.enabled = seatData.enabled;
    this.book = seatData.book;  //NOTE: just reference

    //this data cannot be updated (at least for now)
    //this.sid = sid;
    //this.x = seatData.x;
    //this.y = seatData.y;
    //this.zid = seatData.zid;
    //this.seatDiv = null;
}


WarpSeat.prototype._createDiv = function(rootDiv, spriteURL) {

    if (this.seatDiv)
        throw Error("seatDiv already created")

    this.seatDiv =  document.createElement("div");
    this.seatDiv.style.position = "absolute";
    this.seatDiv.style.left = this.x + "px";
    this.seatDiv.style.top = this.y + "px";
    this.seatDiv.style.width = WarpSeat.Defines.spriteSize + "px";
    this.seatDiv.style.height = WarpSeat.Defines.spriteSize + "px";
    this.seatDiv.style.backgroundImage = 'url('+spriteURL+')';
    this.seatDiv.style.display = "none";

    this.seatDiv.addEventListener('click',this);
    this.seatDiv.addEventListener('mouseover',this);
    this.seatDiv.addEventListener('mouseout',this);

    rootDiv.appendChild(this.seatDiv);
};