"use strict";

function WarpSeat(sid) {

    if (!WarpSeat._Instances)
        throw new Error("WaprSeat not initialized. Call WarpSeat.Init() first.");

    if (sid in WarpSeat._Instances)
        return WarpSeat._Instances[sid];

    if (!WarpSeat._data.seatsData)
        throw new Error("WaprSeat: seatsData not initialized. Call WarpSeat.Init() first.");

    if (!(sid in WarpSeat._data.seatsData))
        throw new Error("WaprSeat: sid="+sid+"doesn't exists (in seatsData).");

    this.sid = sid;
    this.action = WarpSeat.SeatStates.DISABLED;
    WarpSeat._Instances[sid] = this;

    if (!WarpSeat._data.seatsData[this.sid].other_zone)
        this._createDiv();
};

WarpSeat.SeatStates = {
    TAKEN: 0,           // seat is booked by another user
    DISABLED: 1,        // seat is disabled
    CAN_BOOK: 2,        // seat is available to be booked
    CAN_REBOOK: 3,      // seat is available to be booked, but other seat is already booked (NOTE: this state is only returned by getState, it is not used internally)
    CAN_CHANGE: 4,      // seat is already booked by this user, but can be changed (extended, reduced, deleted)
    CAN_DELETE: 5,      // seat is already booked by this user, but cannot be changed
    CAN_DELETE_EXACT: 6 // seat is already booked by this user, cannot be changed and selected dated are exactly matching booking dates
}

WarpSeat.getInstance = function(sid) { 

    if (!WarpSeat._Instances)
        throw new Error("WaprSeat not initialized. Initialize it in WarpSeat.Init() or call WarpSeat.updateSeatsData() first.");

    return WarpSeat._Instances[sid];
};

// NOTE: seatsData is not cloned
WarpSeat.Init = function(spriteURL,rootDivId, uid, seatsData) {

    WarpSeat._data = {
        seatsData: {},    // this will be updated via WarpSeat.updateSeatsData
        rootDiv: document.getElementById(rootDivId),
        uid: uid,
        myBookings: 0,    // number of seats booked by the current user for selected dates, used in updateState/updateView
        sprites: {
            SIZE: 48,
            URL: spriteURL,
            book: "-144px",
            rebook: "-192px",
            conflict: "-240px",
            user_conflict: "-48px",
            user_exact: "0px",
            user_rebook: "-96px",
            disabled: "-288px"
        }
    };

    WarpSeat.listeners = {
        click: new Set(), 
        mouseover: new Set(), 
        mouseout: new Set()
    };

    WarpSeat._Instances = {};
    WarpSeat.updateSeatsData(seatsData);
};

/**
 * @param {Object[]} selectedDates - list of selected dates [ {from: timestamp, to: timestamp}, ... ]
 */
 WarpSeat.updateView = function(selectedDates) {

    if (!WarpSeat._Instances)
        throw new Error("WaprSeat not initialized. Initialize it in WarpSeat.Init() or call WarpSeat.updateSeatsData() first.");

    for (var seat of Object.values(WarpSeat._Instances)  )
        seat.updateState(selectedDates);

    for (var seat of Object.values(WarpSeat._Instances))
        seat.updateView();

 }


// NOTE: seatsData is not cloned
// you should call WarpSeat.updateView after this (it is not called automatically)
WarpSeat.updateSeatsData = function(seatsData = {}) {

    if (!WarpSeat._Instances)
        throw new Error("WaprSeat not initialized. Call WarpSeat.Init() first.");

    var oldSeatsIds = new Set( Object.keys(WarpSeat._Instances))
    WarpSeat._data.seatsData = seatsData;

    //create possibly missing seats
    for (var sid in seatsData) {
        if (!oldSeatsIds.delete(sid)) {
            new WarpSeat(sid);
        }
    }
    //delete seats which don't exist anymore
    for (var sid of oldSeatsIds) {
        WarpSeat._Instances[sid].destroy();
    }
};

/**
 * Register callback on all seats
 * @param {string} type - event type, one of click, mouseover, mouseout
 * @param {function} listener 
 */
WarpSeat.on = function(type,listener) {
    if (type in WarpSeat.listeners && typeof(listener) === 'function') {
        WarpSeat.listeners[type].add(listener);
    }
}

/**
 * Unregisters callback, if called without listener unregisters all callbacks for the event
 * @param {*} type - event type, one of click, mouseover, mouseout
 * @param {*} [listener]
 */
WarpSeat.off = function(type,listener) {
    if (type in WarpSeat.listeners) {
        if (listener)
            WarpSeat.listeners[type].delete(listener);
        else
            WarpSeat.listeners[type].clear();
    }
}

WarpSeat.prototype.getState = function() {

    if (this.state == WarpSeat.SeatStates.CAN_BOOK && WarpSeat._data.myBookings > 0)
        return WarpSeat.SeatStates.CAN_REBOOK;

    return this.state;
}

WarpSeat.prototype.getPositionAndSize = function() {
    return { 
        x: WarpSeat._data.seatsData[this.sid].x, 
        y: WarpSeat._data.seatsData[this.sid].y,
        size: WarpSeat._data.sprites.SIZE
     };
}

WarpSeat.prototype.getName = function() {   
    return WarpSeat._data.seatsData[this.sid].name;
}

WarpSeat.prototype.getSid = function() {   
    return parseInt(this.sid);
}


WarpSeat.prototype.getAllBookings = function() {
    return WarpSeat._data.seatsData[this.sid].book;
}

/**
 * Returns preformatted booking list
 * @param {Object[]} selectedDates - list of selected dates [ {from: timestamp, to: timestamp}, ... ]
 * @returns array of { bid: bid, datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm", user: "username" }
 *          in case (which should not happen) that reservation is accross days, 
 *          datetime{12} will be "yyyy-mm-dd hh:mm"
 */
WarpSeat.prototype.getBookings = function(selectedDates) {

    var bookings = this.getAllBookings();
    var res = [];

    function formatDatePair(fromTS,toTS) {

        var fromStr = new Date(fromTS*1000).toISOString();
        var toStr = new Date(toTS*1000).toISOString();

        if (fromStr.substring(0,10) == toStr.substring(0,10)) {
            return [
                fromStr.substring(0,10),
                fromStr.substring(11,16)+"-"+toStr.substring(11,16)
            ];
        }
        else {
            return [
                fromStr.substring(0,16).replace('T',' '),
                toStr.substring(0,16).replace('T',' ')
            ];
        }
    }

    date_loop:
    for (var date of selectedDates) {
        for (var book of bookings) {
            if ( book.fromTS >= date.toTS ) // book is sorted by fromTS, so we can optimize
                break;
            else if (book.toTS > date.fromTS) {
                var dateStr = formatDatePair(book.fromTS,book.toTS);

                res.push( {
                    bid: book.bid,
                    datetime1: dateStr[0],
                    datetime2: dateStr[1],
                    user: book.username
                });
            }
        }
    }

    return res;
}


/**
 * @param {Object[]} selectedDates - list of selected dates [ {from: timestamp, to: timestamp}, ... ]
 */
WarpSeat.prototype.updateState = function(selectedDates) {
    
    var bookings = this.getAllBookings();

    var isFree = true;
    var isMy = false;
    var isExact = 0;

    date_loop:
    for (var date of selectedDates) {

        for (var book of bookings) {

            if ( book.fromTS >= date.toTS ) { // book is sorted by fromTS, so we can optimize here
                break;
            }
            else if (book.toTS > date.fromTS) {

                if (book.uid == WarpSeat._data.uid) {

                    isMy = true;

                    if (book.fromTS == date.fromTS && book.toTS == date.toTS)
                        ++isExact;

                    if (!isFree)
                        break date_loop;
                }
                else {
                    isFree = false;
                    if (isMy)
                        break date_loop;
                }
            }
        }
    }

    switch (this.state) {
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
        case WarpSeat.SeatStates.CAN_CHANGE:
        case WarpSeat.SeatStates.CAN_DELETE:
            --WarpSeat._data.myBookings;
    }

    if (isMy) {

        ++WarpSeat._data.myBookings;

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

// as this function relays on WarpSeat._data.myBookings 
// it should be called after all WarpSeats' states are updated
WarpSeat.prototype.updateView = function() {

    // seats form other zones doesn't have divs created
    if (!this.seatDiv)
        return;

    switch (this.state) {

        case WarpSeat.SeatStates.CAN_CHANGE:
            this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.user_rebook;
            break;
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
            this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.user_exact;
            break;
        case WarpSeat.SeatStates.CAN_DELETE:
            this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.user_conflict;
            break;
        case WarpSeat.SeatStates.CAN_BOOK:
            if (WarpSeat._data.myBookings > 0)
                this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.rebook;
            else
                this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.book;
            break;
        case WarpSeat.SeatStates.TAKEN:
            this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.conflict;
            break;
        default: /* WarpSeat.SeatStates.DISABLED */
            this.seatDiv.style.backgroundPositionX = WarpSeat._data.sprites.disabled;
            break;
    }

    this.seatDiv.style.display = "block";
}

WarpSeat.prototype.destroy = function() {

    switch (this.state) {
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
        case WarpSeat.SeatStates.CAN_CHANGE:
        case WarpSeat.SeatStates.CAN_DELETE:
            --WarpSeat._data.myBookings;
    }

    delete WarpSeat._Instances[this.sid];

    if (this.seatDiv) {
        this.seatDiv.removeEventListener('click',this);
        this.seatDiv.removeEventListener('mouseover',this);
        this.seatDiv.removeEventListener('mouseout',this);
        this.seatDiv.remove();    
    }
};

WarpSeat.prototype.handleEvent = function(e) {
    if (e.type in WarpSeat.listeners) {
        for (var l of WarpSeat.listeners[e.type]) {
            l.call(this);
        }
    }
};

WarpSeat.prototype._createDiv = function() {

    this.seatDiv =  document.createElement("div");
    this.seatDiv.style.position = "absolute";
    this.seatDiv.style.left = WarpSeat._data.seatsData[this.sid]['x'] + "px";
    this.seatDiv.style.top = WarpSeat._data.seatsData[this.sid]['y'] + "px";
    this.seatDiv.style.width = WarpSeat._data.sprites.SIZE + "px";
    this.seatDiv.style.height = WarpSeat._data.sprites.SIZE + "px";
    this.seatDiv.style.backgroundImage = 'url('+WarpSeat._data.sprites.URL+')';
    this.seatDiv.style.display = "none";

    this.seatDiv.addEventListener('click',this);
    this.seatDiv.addEventListener('mouseover',this);
    this.seatDiv.addEventListener('mouseout',this);

    WarpSeat._data.rootDiv.appendChild(this.seatDiv);
};