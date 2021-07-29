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
    this.myBookings = factory.myBookings; //TODO
    this.uid = factory.uid;

    this.sid = sid;
    this.x = seatData.x;
    this.y = seatData.y;
    this.name = seatData.name;
    this.otherZone = seatData.other_zone;
    this.book = seatData.book;  //NOTE: just reference
    this.seatDiv = null;
    
    if (!this.otherZone) {
        this._createDiv(factory.rootDiv, factory.spriteURL);
    }
    
    this.action = WarpSeat.SeatStates.DISABLED;
};

WarpSeat.SeatStates = {
    TAKEN: 0,           // seat is booked by another user
    DISABLED: 1,        // seat is disabled
    CAN_BOOK: 2,        // seat is available to be booked
    CAN_REBOOK: 3,      // seat is available to be booked, but other seat is already booked (IMPLEMENTATION NOTE: this state is set in _updateView)
    CAN_CHANGE: 4,      // seat is already booked by this user, but can be changed (extended, reduced, deleted)
    CAN_DELETE: 5,      // seat is already booked by this user, but cannot be changed
    CAN_DELETE_EXACT: 6 // seat is already booked by this user, cannot be changed and selected dated are exactly matching booking dates
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

function WarpSeatFactory(spriteURL,rootDivId, uid) {

    this.spriteURL = spriteURL;
    this.rootDiv = document.getElementById(rootDivId);
    this.uid = uid;
    this.selectedDates = [];

    this.instances = {};
    this.listeners = {
        click: new Set(), 
        mouseover: new Set(), 
        mouseout: new Set()
    };

    this.myBookings = [0];    //TODO
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
            this.instances[sid]._setBook(seatsData[sid].book);
        }
    }
    //delete seats which don't exist anymore
    for (var sid of oldSeatsIds) {
        this.instances[sid]._destroy();
        delete this.instances[sid];
    }
};

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


WarpSeat.prototype.getAllBookings = function() {
    return this.book;
}

/**
 * Returns preformatted booking list
 * @returns array of { bid: bid, datetime1: "yyyy-mm-dd", datetime2: "hh:mm-hh:mm", user: "username" }
 *          in case (which should not happen) that reservation is accross days, 
 *          datetime{12} will be "yyyy-mm-dd hh:mm"
 */
WarpSeat.prototype.getBookings = function() {

    var bookings = this.getAllBookings();
    var selectedDates = this.selectedDates;

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

WarpSeat.prototype._updateState = function() {
    
    var bookings = this.getAllBookings();
    var selectedDates = this.selectedDates;

    if (!selectedDates.length) {
        this.state = WarpSeat.SeatStates.DISABLED;
        return this.state;
    }

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

                if (book.uid == this.uid) {

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
            --this.myBookings[0];
    }

    if (isMy) {

        ++this.myBookings[0];

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

// as this function relays on myBookings 
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
            if (this.myBookings[0] > 0) {
                this.state = WarpSeat.SeatStates.CAN_REBOOK;    //this is not very elegant
                this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteRebookOffset;
            }
            else
                this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteBookOffset;
            break;
        case WarpSeat.SeatStates.TAKEN:
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteConflictOffset;
            break;
        default: /* WarpSeat.SeatStates.DISABLED */
            this.seatDiv.style.backgroundPositionX = WarpSeat.Defines.spriteDisabledOffset;
            break;
    }

    this.seatDiv.style.display = "block";
}

WarpSeat.prototype._destroy = function() {

    switch (this.state) {
        case WarpSeat.SeatStates.CAN_DELETE_EXACT:
        case WarpSeat.SeatStates.CAN_CHANGE:
        case WarpSeat.SeatStates.CAN_DELETE:
            --this.myBookings[0];
    }

    // dereference factory objects
    this.listeners = null;
    this.selectedDates = null;
    this.myBookings = null; //TODO

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

WarpSeat.prototype._setBook = function(book) {
    this.book = book;
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