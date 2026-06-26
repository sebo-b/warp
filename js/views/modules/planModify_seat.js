"use strict";

import Utils from './utils.js';

// TODO: make a base Seat class and merge it with Seat in Zone
function Seat(id, data, overlay, parentDiv) {

    this.id = id;
    this.data = data;
    this.overlay = overlay;

    this.__select = false;

    this.listeners = new Utils.Listeners(['change'],true);
    this.on = this.listeners.on.bind(this.listeners);

    this._createDiv(parentDiv);
}

Seat.CONFIG = {

    spriteSize: 48,

    newNamePrefix: "NEW_",
    newSidPrefix: "DUMMY_",
    DELETED: "DELETED",

    // Editor seat state -> #cell-<name>. Each cell bakes its colours from the
    // :root theme vars (see seat_icons.svg); the editor just picks the cell
    // matching the state. Same cells as OfficeMap's booking view + the help modal.
    cells: {
        new:      'available',    // green plus  — a not-yet-saved seat
        edited:   'edited',       // green head — an existing seat with unsaved changes
        existing: 'yours',         // blue head  — an unmodified real seat
        deleted:  'unavailable'    // grey X     — a seat marked for deletion
    },

    // Reference view: cycle the full sprite vocabulary (same set as the booking
    // help modal), keeping each shape's available/yours/unavailable colour family.
    referenceCells: ['available', 'rebook', 'yours', 'yoursChange', 'unavailable', 'assigned']
}

Seat.prototype.silentSetXY = function(x,y) {

    x = Math.max(Math.round(x),0);
    y = Math.max(Math.round(y),0);

    if (this.data.x == x)
        delete this.overlay['x'];
    else
        this.overlay['x'] = x;

    if (this.data.y == y)
        delete this.overlay['y'];
    else
        this.overlay['y'] = y;

    this._updateDiv();

}

Seat.prototype.isNew = function() {
    return this.id.startsWith(Seat.CONFIG.newSidPrefix);
}

Seat.prototype._destroy = function() {

    this.seatDiv.parentNode.removeChild(this.seatDiv);
    if (this.labelDiv && this.labelDiv.parentNode)
        this.labelDiv.parentNode.removeChild(this.labelDiv);
    Object.keys(this.overlay).forEach((e) => delete this.overlay[e]);
}

Seat.prototype._updateData = function(data) {

    this.data = data;
    Object.keys(this.overlay).forEach((e) => delete this.overlay[e]);
    this._updateDiv();
}

Seat.prototype._createDiv = function(parentDiv) {

    this.seatDiv = document.createElement("div");
    this.seatDiv.className = "seat-icon";
    this.seatDiv.style.position = "absolute";
    this.seatDiv.style.width = Seat.CONFIG.spriteSize + "px";
    this.seatDiv.style.height = Seat.CONFIG.spriteSize + "px";

    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", "48");
    svg.setAttribute("height", "48");

    this.seatUse = document.createElementNS("http://www.w3.org/2000/svg", "use");
    this.seatUse.setAttribute("href", window.warpGlobals.URLs['seatSprite'] + "#cell-" + Seat.CONFIG.cells.existing);

    svg.appendChild(this.seatUse);
    this.seatDiv.appendChild(svg);

    // Label div (class seat_label) — appended to same parent, pointer-events:none
    this.labelDiv = document.createElement("div");
    this.labelDiv.className = "seat_label";

    this.labelTitle = this.labelDiv.appendChild(document.createElement("div"));
    this.labelTitle.className = "seat_label_title";

    this.labelZone = null; // created lazily when multi-zone

    parentDiv.appendChild(this.seatDiv);
    parentDiv.appendChild(this.labelDiv);

    this._updateDiv();
}

Seat.prototype._setLabelVisible = function(visible) {
    if (this.labelDiv)
        this.labelDiv.style.display = visible ? '' : 'none';
};

Seat.prototype._updateDiv = function() {
    this.seatDiv.style.left = this.x + "px";
    this.seatDiv.style.top = this.y + "px";

    var cell = Seat.CONFIG.cells.existing;

    if (this.factory && this.factory.referenceMode) {
        cell = this.referenceCell || Seat.CONFIG.referenceCells[0];
    }
    else if (this.isNew()) {
        cell = Seat.CONFIG.cells.new;
    }
    else if (this.deleted) {
        cell = Seat.CONFIG.cells.deleted;
    }
    else if (Object.keys(this.overlay).length > 0) {
        cell = Seat.CONFIG.cells.edited;
    }

    var newHref = window.warpGlobals.URLs['seatSprite'] + "#cell-" + cell;
    if (this.seatUse.getAttribute("href") !== newHref)
        this.seatUse.setAttribute("href", newHref);

    if (this.__select)
        this.seatDiv.style.outline = "2px solid var(--warp-error)";
    else
        this.seatDiv.style.outline = "";

    this._updateLabel();
}

Seat.prototype._updateLabel = function() {

    if (!this.labelDiv) return;

    var TITLE_HEIGHT = 14;
    var SPRITE_CENTER_X = Seat.CONFIG.spriteSize / 2;

    // Position: centred below the seat sprite
    this.labelDiv.style.left = (this.x + SPRITE_CENTER_X) + "px";
    this.labelDiv.style.top = (this.y + Seat.CONFIG.spriteSize - TITLE_HEIGHT) + "px";

    // Title text = seat name
    this.labelTitle.textContent = this.name || '';

    // Zone line: only when factory reports multi-zone
    var factory = this.factory;
    if (factory && factory.multiZone) {
        if (!this.labelZone) {
            this.labelZone = this.labelDiv.appendChild(document.createElement("div"));
            this.labelZone.className = "seat_label_zone";
        }
        var zoneName = (factory.zonesNames && this.zid in factory.zonesNames)
            ? factory.zonesNames[this.zid]
            : '';
        this.labelZone.textContent = zoneName;
    } else if (this.labelZone) {
        this.labelZone.remove();
        this.labelZone = null;
    }

    // Greyed state for deleted seats
    if (this.deleted)
        this.labelDiv.classList.add('seat_label_deleted');
    else
        this.labelDiv.classList.remove('seat_label_deleted');
};

Object.defineProperty(Seat.prototype, "deleted", {
    get: function() {
        return Seat.CONFIG.DELETED in this.overlay;
    },
    set: function(v) {

        if (this.deleted == v)
            return;

        if (v)
            this.overlay[Seat.CONFIG.DELETED] = true;
        else
            delete this.overlay[Seat.CONFIG.DELETED];

        this._updateDiv();
        this.listeners.fireEvent('change',this,this);
    }
});


Object.defineProperty(Seat.prototype, "select", {
    get: function() {
        return this.__select;
    },
    set: function(v) {
        if (this.__select != v) {
            this.__select = v;
            this._updateDiv();
        }
    }
});

Seat._getterFactory = function(propName) {
    return function() {
        if (propName in this.overlay)
            return this.overlay[propName];
        else
            return this.data[propName];
    }
}

Seat._setterFactory = function(propName,mutator = a => a) {
    return function(value) {

        if (this.data[propName] === mutator(value) && propName in this.overlay) {
                delete this.overlay[propName];
        }
        else if (this.overlay[propName] !== mutator(value)) {
            this.overlay[propName] = mutator(value);
        }
        else
            return;

        this._updateDiv();
        this.listeners.fireEvent('change',this,this);
    }
}

Object.defineProperty(Seat.prototype, "name", { get: Seat._getterFactory('name'), set: Seat._setterFactory('name') } );
Object.defineProperty(Seat.prototype, "x", { get: Seat._getterFactory('x'), set: Seat._setterFactory('x',(a) => Math.max(Math.round(a),0)) } );
Object.defineProperty(Seat.prototype, "y", { get: Seat._getterFactory('y'), set: Seat._setterFactory('y',(a) => Math.max(Math.round(a),0)) } );
Object.defineProperty(Seat.prototype, "zid", { get: Seat._getterFactory('zid'), set: Seat._setterFactory('zid') } );

function SeatFactory(url,parentDiv,zoneMapImg) {

    this.url = url;
    this.parentDiv = parentDiv;
    this.zoneMapImg = zoneMapImg;
    this.instances = {};
    this.overlay = {};

    this.zonesNames = {};
    this.multiZone = false;

    this.newSeatCounter = 1;

    this.selectedSeat = null;
    this.drag = {
        state: false,
        offsetX: 0,
        offsetY: 0,
    };

    this.suppressDeselect = false;

    this.listeners = new Utils.Listeners(['select','unselect','drag','change','init']);
    this.on = this.listeners.on.bind(this.listeners);

    this.parentDiv.addEventListener("mouseout", this._zoneMouseOut.bind(this));
    this.parentDiv.addEventListener("mousemove", this._zoneMouseMove.bind(this));
    this.parentDiv.addEventListener("mousedown", this._zoneMouseDown.bind(this));
}

SeatFactory.prototype._recomputeMultiZone = function() {

    var zoneIds = new Set();
    for (var sid in this.instances) {
        var seat = this.instances[sid];
        if (seat.deleted) continue;
        // Skip seats with no zone yet (e.g. a just-placed seat before its zid is
        // assigned) so they don't transiently count as a distinct zone.
        if (seat.zid === undefined || seat.zid === null) continue;
        zoneIds.add(seat.zid);
    }
    var was = this.multiZone;
    this.multiZone = zoneIds.size > 1;
    // If multi-zone toggled, refresh all labels (zone line appears/disappears)
    if (was !== this.multiZone) {
        for (var sid in this.instances) {
            this.instances[sid]._updateLabel();
        }
    }
};

SeatFactory.prototype.setZonesNames = function(map) {

    this.zonesNames = map || {};
    this._recomputeMultiZone();
    // Refresh all labels so zone names and visibility update
    for (var sid in this.instances) {
        this.instances[sid]._updateLabel();
    }
};

SeatFactory.prototype._resetSelectionState = function() {

    this.drag.state = false;

    if (this.selectedSeat) {
        let s = this.selectedSeat;
        this.selectedSeat.select = false;
        this.selectedSeat = null;

        this.listeners.fireEvent('unselect',this,s);
    }
}

SeatFactory.prototype.updateData = function() {

    this._resetSelectionState();

    Utils.xhr.get(
        this.url,
        {toastOnSuccess:false})
    .then( (v) => {

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
            delete this.overlay[sid];
        }

        this.listeners.fireEvent('init',this,null);
        this.listeners.fireEvent('change',this,null);
        this._recomputeMultiZone();
    });
}

SeatFactory.prototype.isChanged = function() {

    for (let i in this.overlay) {
        if (Object.keys(this.overlay[i]).length > 0)
            return true;
    }

    return false;
}

SeatFactory.prototype.getChanges = function() {

    let res = {
        addOrUpdate: [],
        remove: []
    };

    for (let sid in this.overlay) {

        let value = this.overlay[sid]

        if (Object.keys(value).length == 0)
            continue;

        if (sid.startsWith(Seat.CONFIG.newSidPrefix)) {
            if (Seat.CONFIG.DELETED in value) {//this should not happen
                console.error("Deleted in artificial seat");
                continue;
            }
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


SeatFactory.prototype.setReferenceMode = function(enabled) {

    this.referenceMode = enabled;
    var icons = Seat.CONFIG.referenceCells;
    var seats = Object.values(this.instances);

    for (var i = 0; i < seats.length; i++) {
        var seat = seats[i];
        seat.referenceCell = icons[i % icons.length];
        seat._updateDiv();
        seat._setLabelVisible(!enabled);
    }
};

SeatFactory.prototype.createNewSeat = function(name,x,y) {

    let newSid = this.newSeatCounter++;

    name = name || Seat.CONFIG.newNamePrefix + newSid;
    newSid = Seat.CONFIG.newSidPrefix + newSid;

    if (newSid in this.instances)
        throw Error("Something is very wrong.")

    this.overlay[newSid] = {
        name: name,
        x: Math.round(x - Seat.CONFIG.spriteSize/2),
        y: Math.round(y - Seat.CONFIG.spriteSize/2),
    };

    let seat = this._createSeat(newSid,{});
    seat.nameChangedFromPlaceholder = false;  // set true when the user edits the name

    this._resetSelectionState();
    this.selectedSeat = seat;
    this.selectedSeat.select = true;
    this.listeners.fireEvent('select',this,seat);
    this.listeners.fireEvent('change',this,seat);
}

SeatFactory.prototype.deleteRestoreSeat = function(seat) {

    if (seat == null)
        return;

    if (seat.deleted) {
        seat.deleted = false;
    }
    else {

        let sid = seat.id;

        if (sid.startsWith(Seat.CONFIG.newSidPrefix)) {

            seat._destroy();
            delete this.instances[sid];
            delete this.overlay[sid];

            if (this.selectedSeat == seat)
                this._resetSelectionState();

            this.listeners.fireEvent('change',this,seat);
        }
        else {
            seat.deleted = true;
        }
    }
}

SeatFactory.prototype.getSelectedSeat = function() {
    return this.selectedSeat;
}

SeatFactory.prototype.clearSelection = function() {
    this._resetSelectionState();
}

SeatFactory.prototype.seatAt = function(px, py) {

    for (let sid in this.instances) {
        var s = this.instances[sid];
        if (s.deleted)
            continue;
        if (px >= s.x && px <= s.x + Seat.CONFIG.spriteSize &&
            py >= s.y && py <= s.y + Seat.CONFIG.spriteSize)
            return s;
    }

    return null;
}

SeatFactory.prototype.getTransformSeats = function() {

    let result = [];

    for (let sid in this.instances) {
        if (!this.instances[sid].deleted)
            result.push(this.instances[sid]);
    }

    return result;
}

SeatFactory.prototype._seatOnChange = function(seat) {

    this.listeners.fireEvent('change',this,seat);
    this._recomputeMultiZone();
}

SeatFactory.prototype._seatMouseDown = function(seat,e) {

    if (this.selectedSeat) {
        this.selectedSeat.select = false;
        this.listeners.fireEvent('unselect',this.selectedSeat);
    }

    this.selectedSeat = seat;
    this.selectedSeat.select = true;

    this.drag.state = true;
    this.drag.offsetX = e.offsetX;
    this.drag.offsetY = e.offsetY;

    e.stopPropagation();

    this.listeners.fireEvent('select',this,seat);
}

SeatFactory.prototype._seatMouseUp = function(e) {
    this.drag.state = false;
}

SeatFactory.prototype._zoneMouseOut = function(e) {
    if (this.drag.state && !this.parentDiv.contains(e.relatedTarget))
        this.drag.state = false;
}

SeatFactory.prototype._zoneMouseDown = function(e) {
    if (this.suppressDeselect) {
        this.suppressDeselect = false;
        return;
    }
    if (this.selectedSeat) {
        let s = this.selectedSeat;
        this.selectedSeat.select = false;
        this.selectedSeat = null;
        this.listeners.fireEvent('unselect',this,s);
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

    this.listeners.fireEvent('drag',this,this.selectedSeat);
}

SeatFactory.prototype._createSeat = function(sid,data) {

    if (sid in this.instances)
        throw Error('id already exists');

    if (!(sid in this.overlay))
        this.overlay[sid] = {};

    let seat = new Seat(sid, data, this.overlay[sid], this.parentDiv);
    seat.factory = this;
    this.instances[sid] = seat;
    seat.on('change',this._seatOnChange.bind(this));

    let seatDiv = seat.seatDiv;
    seatDiv.addEventListener("mousedown", this._seatMouseDown.bind(this,seat));
    seatDiv.addEventListener("mouseup", this._seatMouseUp.bind(this));

    return seat;
}

export const spriteSize = Seat.CONFIG.spriteSize;
export { SeatFactory as default, SeatFactory };
