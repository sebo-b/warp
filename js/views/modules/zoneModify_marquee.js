"use strict";

function MarqueeController(parentDiv, spriteSize) {

    this.parentDiv = parentDiv;
    this.spriteSize = spriteSize;
    this.active = false;

    this._box = null;
    this._handles = {};
    this._rotateHandle = null;

    this._boxRect = null;
    this._handleRects = {};
    this._rotateRect = null;

    this._createElements();
}

MarqueeController.CORNER_SIZE    = 10;
MarqueeController.H_EDGE_W       = 18;
MarqueeController.H_EDGE_H       = 10;
MarqueeController.V_EDGE_W       = 10;
MarqueeController.V_EDGE_H       = 18;
MarqueeController.ROTATE_SIZE    = 24;
MarqueeController.ROTATE_OFFSET  = 18;

MarqueeController.HANDLE_CURSORS = {
    nw: 'nwse-resize',
    ne: 'nesw-resize',
    sw: 'nesw-resize',
    se: 'nwse-resize',
    n:  'ns-resize',
    s:  'ns-resize',
    e:  'ew-resize',
    w:  'ew-resize',
};

MarqueeController.prototype._createElements = function() {

    this._box = document.createElement("div");
    this._box.className = "zone_modify_marquee_box";
    this._box.style.display = "none";
    this.parentDiv.appendChild(this._box);

    var cornerKeys = ['nw','ne','sw','se'];
    for (var i = 0; i < cornerKeys.length; i++) {
        var key = cornerKeys[i];
        var handle = document.createElement("div");
        handle.className = "zone_modify_marquee_handle zone_modify_marquee_corner";
        handle.style.display = "none";
        handle.style.cursor = MarqueeController.HANDLE_CURSORS[key];
        this._handles[key] = handle;
        this.parentDiv.appendChild(handle);
    }

    var n = document.createElement("div");
    n.className = "zone_modify_marquee_handle zone_modify_marquee_edge_h";
    n.style.display = "none";
    n.style.cursor = MarqueeController.HANDLE_CURSORS['n'];
    this._handles['n'] = n;
    this.parentDiv.appendChild(n);

    var s = document.createElement("div");
    s.className = "zone_modify_marquee_handle zone_modify_marquee_edge_h";
    s.style.display = "none";
    s.style.cursor = MarqueeController.HANDLE_CURSORS['s'];
    this._handles['s'] = s;
    this.parentDiv.appendChild(s);

    var e = document.createElement("div");
    e.className = "zone_modify_marquee_handle zone_modify_marquee_edge_v";
    e.style.display = "none";
    e.style.cursor = MarqueeController.HANDLE_CURSORS['e'];
    this._handles['e'] = e;
    this.parentDiv.appendChild(e);

    var w = document.createElement("div");
    w.className = "zone_modify_marquee_handle zone_modify_marquee_edge_v";
    w.style.display = "none";
    w.style.cursor = MarqueeController.HANDLE_CURSORS['w'];
    this._handles['w'] = w;
    this.parentDiv.appendChild(w);

    this._rotateHandle = document.createElement("div");
    this._rotateHandle.className = "zone_modify_marquee_rotate";
    this._rotateHandle.style.display = "none";
    this._rotateHandle.innerHTML =
        '<svg width="24" height="24" viewBox="0 0 24 24" style="display:block">' +
        '<circle cx="12" cy="12" r="10" fill="white" stroke="#3949ab" stroke-width="2"/>' +
        '<path d="M17 8a6 6 0 1 0 1.1 6.4" fill="none" stroke="#3949ab" stroke-width="2" stroke-linecap="round"/>' +
        '<polyline points="17,5 17,8 14,8" fill="none" stroke="#3949ab" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</svg>';
    this.parentDiv.appendChild(this._rotateHandle);

    this._rotateLine = document.createElement("div");
    this._rotateLine.className = "zone_modify_rotate_line";
    this._rotateLine.style.display = "none";
    this.parentDiv.appendChild(this._rotateLine);

    this._rotatePivot = document.createElement("div");
    this._rotatePivot.className = "zone_modify_rotate_pivot";
    this._rotatePivot.style.display = "none";
    this.parentDiv.appendChild(this._rotatePivot);

    this._rotateLabel = document.createElement("div");
    this._rotateLabel.className = "zone_modify_rotate_label";
    this._rotateLabel.style.display = "none";
    this.parentDiv.appendChild(this._rotateLabel);
};

MarqueeController.PIVOT_SIZE = 12;

MarqueeController.prototype.showRotateGuide = function(pivot, px, py, angleRad) {

    this.hide();

    var po = MarqueeController.PIVOT_SIZE / 2;
    this._rotatePivot.style.left = (pivot.x - po) + "px";
    this._rotatePivot.style.top = (pivot.y - po) + "px";
    this._rotatePivot.style.display = "";

    this._rotateLine.style.display = "";
    this._rotateLabel.style.display = "";

    this.updateRotateGuide(pivot, px, py, angleRad);
};

MarqueeController.prototype.updateRotateGuide = function(pivot, px, py, angleRad) {

    var dx = px - pivot.x;
    var dy = py - pivot.y;
    var len = Math.sqrt(dx * dx + dy * dy);
    var theta = Math.atan2(dy, dx);

    this._rotateLine.style.left = pivot.x + "px";
    this._rotateLine.style.top = pivot.y + "px";
    this._rotateLine.style.width = len + "px";
    this._rotateLine.style.transform = "rotate(" + theta + "rad)";

    var deg = Math.round(angleRad * 180 / Math.PI);
    this._rotateLabel.textContent = deg + "°";
    this._rotateLabel.style.left = (px + 16) + "px";
    this._rotateLabel.style.top = (py + 16) + "px";
};

MarqueeController.prototype.hideRotateGuide = function() {

    this._rotateLine.style.display = "none";
    this._rotatePivot.style.display = "none";
    this._rotateLabel.style.display = "none";
};

MarqueeController.prototype.show = function(seats) {

    this.active = true;

    var bounds = this._computeBounds(seats);
    if (!bounds) {
        this.hide();
        return;
    }

    this._box.style.left = bounds.x + "px";
    this._box.style.top = bounds.y + "px";
    this._box.style.width = bounds.w + "px";
    this._box.style.height = bounds.h + "px";
    this._box.style.display = "";

    this._positionHandles(bounds);
};

MarqueeController.prototype.hide = function() {

    this.active = false;

    this._box.style.display = "none";

    for (var k in this._handles) {
        this._handles[k].style.display = "none";
    }
    this._rotateHandle.style.display = "none";
};

MarqueeController.prototype.update = function(seats) {

    var bounds = this._computeBounds(seats);
    if (!bounds)
        return;

    this._box.style.left = bounds.x + "px";
    this._box.style.top = bounds.y + "px";
    this._box.style.width = bounds.w + "px";
    this._box.style.height = bounds.h + "px";

    this._positionHandles(bounds);
};

MarqueeController.prototype._computeBounds = function(seats) {

    if (seats.length === 0)
        return null;

    var minX = Infinity, minY = Infinity;
    var maxX = -Infinity, maxY = -Infinity;

    for (var i = 0; i < seats.length; i++) {
        var s = seats[i];
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        var right = s.x + this.spriteSize;
        var bottom = s.y + this.spriteSize;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
    }

    return {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        cx: minX + (maxX - minX) / 2,
        cy: minY + (maxY - minY) / 2,
    };
};

MarqueeController.prototype._placeHandle = function(handle, rect) {

    handle.style.left = rect.x + "px";
    handle.style.top = rect.y + "px";
    handle.style.display = "";
};

MarqueeController.prototype._positionHandles = function(bounds) {

    var cs = MarqueeController.CORNER_SIZE;
    var co = cs / 2;

    var hw = MarqueeController.H_EDGE_W;
    var hh = MarqueeController.H_EDGE_H;
    var hwo = hw / 2;
    var hho = hh / 2;

    var vw = MarqueeController.V_EDGE_W;
    var vh = MarqueeController.V_EDGE_H;
    var vwo = vw / 2;
    var vho = vh / 2;

    var rs = MarqueeController.ROTATE_SIZE;
    var ro = rs / 2;
    var off = MarqueeController.ROTATE_OFFSET;

    var boxX = bounds.x;
    var boxY = bounds.y;
    var boxW = bounds.w;
    var boxH = bounds.h;
    var cx = boxX + boxW / 2;
    var cy = boxY + boxH / 2;

    this._boxRect = {x: boxX, y: boxY, w: boxW, h: boxH};

    this._handleRects = {
        nw: {x: boxX - co,        y: boxY - co,        w: cs, h: cs},
        ne: {x: boxX + boxW - co, y: boxY - co,        w: cs, h: cs},
        sw: {x: boxX - co,        y: boxY + boxH - co, w: cs, h: cs},
        se: {x: boxX + boxW - co, y: boxY + boxH - co, w: cs, h: cs},
        n:  {x: cx - hwo,         y: boxY - hho,       w: hw, h: hh},
        s:  {x: cx - hwo,         y: boxY + boxH - hho,w: hw, h: hh},
        e:  {x: boxX + boxW - vwo,y: cy - vho,         w: vw, h: vh},
        w:  {x: boxX - vwo,       y: cy - vho,         w: vw, h: vh},
    };

    this._rotateRect = {x: cx - ro, y: boxY - off - ro, w: rs, h: rs};

    for (var k in this._handleRects)
        this._placeHandle(this._handles[k], this._handleRects[k]);

    this._placeHandle(this._rotateHandle, this._rotateRect);
};

MarqueeController.prototype.getHandleAt = function(px, py) {

    if (!this.active)
        return null;

    var tol = 4;

    for (var k in this._handleRects) {
        var r = this._handleRects[k];
        if (px >= r.x - tol && px <= r.x + r.w + tol &&
            py >= r.y - tol && py <= r.y + r.h + tol)
            return k;
    }

    var rr = this._rotateRect;
    if (px >= rr.x - tol && px <= rr.x + rr.w + tol &&
        py >= rr.y - tol && py <= rr.y + rr.h + tol)
        return 'rotate';

    var br = this._boxRect;
    if (px >= br.x && px <= br.x + br.w && py >= br.y && py <= br.y + br.h)
        return 'box';

    return null;
};

MarqueeController.prototype.onHandleMouseDown = function(callback) {

    var self = this;

    for (var k in this._handles) {
        this._handles[k].addEventListener("mousedown", function(e) {
            e.stopPropagation();
            e.preventDefault();
            var rect = self.parentDiv.getBoundingClientRect();
            var x = e.clientX - rect.left;
            var y = e.clientY - rect.top;
            var handle = self.getHandleAt(x, y);
            if (handle)
                callback(handle, x, y);
        });
    }

    this._rotateHandle.addEventListener("mousedown", function(e) {
        e.stopPropagation();
        e.preventDefault();
        var rect = self.parentDiv.getBoundingClientRect();
        var x = e.clientX - rect.left;
        var y = e.clientY - rect.top;
        var handle = self.getHandleAt(x, y);
        if (handle)
            callback(handle, x, y);
    });
};

export { MarqueeController as default, MarqueeController };
