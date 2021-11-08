
function Seat(id, data, overlay, parentDiv) {
    this.id = id;
    this.data = data;
    this.overlay = overlay;

    this._createDiv(parentDiv);
}

Seat.CONFIG = {
    spriteSize: 48,
    newNamePrefix: "NEW_",
    newSidPrefix: "DUMMY_",
    DELETED: "DELETED",
}

Seat.prototype._destroy = function() {

    this.seatDiv.parentNode.removeChild(this.seatDiv);
    delete this.overlay[this.id];
}

Seat.prototype._updateData = function(data) {

    this.data = data;
    delete this.overlay[this.id];   //this is not really needed, as overlay is anyway cleaned up in the factory before
    this._updateDiv();
}

Seat.prototype._createDiv = function(parentDiv) {

    this.seatDiv = document.createElement("div");

    this.seatDiv.style.position = "absolute";
    this.seatDiv.style.left = this.x + "px";
    this.seatDiv.style.top = this.y + "px";
    this.seatDiv.style.width = Seat.CONFIG.spriteSize + "px";
    this.seatDiv.style.height = Seat.CONFIG.spriteSize + "px";
    this.seatDiv.style.backgroundImage = "url('/static/images/seat_icons.png')"; //TODO

    parentDiv.appendChild(this.seatDiv);
}

Seat.prototype._updateDiv = function() {

    this.seatDiv.style.left = this.x + "px"; //TODO
    this.seatDiv.style.top = this.y + "px"; //TODO
}

Object.defineProperty(Seat.prototype, "select", {
    get: function() {
        return this.seatDiv.style.outline != "";
    },
    set: function(v) {
        this.seatDiv.style.outline = v? "2px solid #b71c1c": "";
    }
});

Seat._getterFactory = function(propName) {
    return function() {
        let v = Object.assign({}, this.data, this.overlay[this.id]);
        return v[propName];
    }
}

Seat._setterFactory = function(propName) {
    return function(value) {
        if (this.data
            && this.data[propName] == value
            && this.id in this.overlay
            && propName in this.overlay[this.id]) {

                delete this.overlay[this.id][propName];
                if (Object.keys(this.overlay[this.id]) == 0)
                    delete this.overlay[this.id];

        }
        else {
            let newValObj = {}
            newValObj[propName] = value;
            this.overlay[this.id] = Object.assign({}, this.overlay[this.id], newValObj);
        }
        this._updateDiv();
    }
}

Object.defineProperty(Seat.prototype, "name", { get: Seat._getterFactory('name'), set: Seat._setterFactory('name') } );
Object.defineProperty(Seat.prototype, "x", { get: Seat._getterFactory('x'), set: Seat._setterFactory('x') } );
Object.defineProperty(Seat.prototype, "y", { get: Seat._getterFactory('y'), set: Seat._setterFactory('y') } );


function SeatFactory(url,parentDiv,zoneMapImg) {

    this.url = url;
    this.parentDiv = parentDiv;
    this.zoneMapImg = zoneMapImg;
    this.instances = {};
    this.overlay = {};

    this.newSeatCounter = 1;

    this.selectedSeat = null;
    this.drag = {
        state: false,
        offsetX: 0,
        offsetY: 0,
    };

    this.listeners = {
        select: new Set(),
        unselect: new Set(),
        drag: new Set()
    };


    this.parentDiv.addEventListener("mouseout", this._zoneMouseOut.bind(this));
    this.parentDiv.addEventListener("mousemove", this._zoneMouseMove.bind(this));
    this.parentDiv.addEventListener("mousedown", this._zoneMouseDown.bind(this));
}

SeatFactory.prototype._resetState = function() {

    this.drag.state = false;

    if (this.selectedSeat) {
        let s = this.selectedSeat;
        this.selectedSeat.select = false;
        this.selectedSeat = null;

        this._fireEvent('unselect',s);
    }
}

SeatFactory.prototype.updateData = function() {

    this._resetState();

    Utils.xhr(this.url,null,false,true,undefined,"GET")
    .then( (v) => {

        Object.keys(this.overlay).forEach( (k) => delete this.overlay[k] );

        let oldIds = new Set( Object.keys(this.instances));
        let newData = v.response;

        for (let sid in newData) {
            if (!oldIds.delete(sid)) {
                this._createSeat(sid,newData[sid]);
            }
            else {
                this.instances[sid]._updateData(newData[sid]);
            }
        }

        for (var sid of oldIds) {
            this.instances[sid]._destroy();
            delete this.instances[sid];
        }
    });
}

SeatFactory.prototype.isChanged = function() {
    return Object.keys(this.overlay).length > 0;
}

SeatFactory.prototype.getChanges = function() {

    let res = {
        addOrUpdate: [],
        remove: []
    };

    for (let sid in this.overlay) {
        let value = this.overlay[sid]
        if (sid.startsWith(Seat.CONFIG.newSidPrefix)) {
            if (Seat.CONFIG.DELETED in value) //this should not happen
                continue;
            res.addOrUpdate.push( Object.assign({},value));
        }
        else if (Seat.CONFIG.DELETED in value) {
            res.remove.push(parseInt(sid));
        }
        else {
            res.addOrUpdate.push( Object.assign({sid: parseInt(sid)},value));
        }
    }

    if (res.addOrUpdate.length == 0)
        delete res.addOrUpdate;
    if (res.remove.length == 0)
        delete res.remove;

    return res;
}


SeatFactory.prototype.createNewSeat = function(name,x,y) {

    let newSid = this.newSeatCounter++;

    name = name || Seat.CONFIG.newNamePrefix + newSid;
    newSid = Seat.CONFIG.newSidPrefix + newSid;

    if (newSid in this.instances)
        throw Error("Something is very wrong.")

    this.overlay[newSid] = {
        name: name,
        x: x - Seat.CONFIG.spriteSize/2,
        y: y - Seat.CONFIG.spriteSize/2,
    };

    let seat = this._createSeat(newSid,null);

    this._resetState();
    this.selectedSeat = seat;
    this.selectedSeat.select = true;
    this._fireEvent('select',seat);
}

SeatFactory.prototype.removeSeat = function(seat) {

    if (seat == null)
        return;

    if (this.selectedSeat == seat)
        this._resetState();

    let sid = seat.id;

    seat._destroy();
    delete this.instances[sid];

    if (!sid.startsWith(Seat.CONFIG.newSidPrefix)) {
        this.overlay[sid] = {}
        this.overlay[sid][Seat.CONFIG.DELETED] = true;
    }
}

SeatFactory.prototype.removeSelectedSeat = function() {
    this.removeSeat(this.selectedSeat);
}

SeatFactory.prototype.on = function(type,listener) {
    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);
    }
}

SeatFactory.prototype._fireEvent = function(type,param) {

    if (!(type in this.listeners))
        return;

    for (let i of this.listeners[type]) {
        setTimeout(i.bind(this),0,param);
    }
}

SeatFactory.prototype._seatMouseDown = function(seat,e) {

    if (this.selectedSeat) {
        this.selectedSeat.select = false;
        this._fireEvent('unselect',this.selectedSeat);
    }

    this.selectedSeat = seat;
    this.selectedSeat.select = true;

    this.drag.state = true;
    this.drag.offsetX = e.offsetX;
    this.drag.offsetY = e.offsetY;

    e.stopPropagation();

    this._fireEvent('select',seat);
}

SeatFactory.prototype._seatMouseUp = function(e) {
    this.drag.state = false;
}

SeatFactory.prototype._zoneMouseOut = function(e) {
    if (this.drag.state && !this.parentDiv.contains(e.relatedTarget))
        this.drag.state = false;
}

SeatFactory.prototype._zoneMouseDown = function(e) {
    if (this.selectedSeat) {
        let s = this.selectedSeat;
        this.selectedSeat.select = false;
        this.selectedSeat = null;
        this._fireEvent('unselect',s);
    }
}

SeatFactory.prototype._zoneMouseMove = function(e) {
    if (!this.drag.state)
        return;
    e.preventDefault();

    var rect = this.zoneMapImg.getBoundingClientRect();
    var x = e.clientX - rect.left; //x position within the element.
    var y = e.clientY - rect.top;  //y position within the element.

    this.selectedSeat.x = x-this.drag.offsetX;
    this.selectedSeat.y = y-this.drag.offsetY;

    this._fireEvent('drag',this.selectedSeat);

}

SeatFactory.prototype._createSeat = function(sid,data) {

    if (sid in this.instances) {
        this.instances[sid]._destroy();
        delete this.instances[sid];
    }

    let seat = new Seat(sid,data, this.overlay, this.parentDiv);
    this.instances[sid] = seat;

    let seatDiv = seat.seatDiv;
    seatDiv.addEventListener("mousedown", this._seatMouseDown.bind(this,seat));
    seatDiv.addEventListener("mouseup", this._seatMouseUp.bind(this));

    return seat;
}
