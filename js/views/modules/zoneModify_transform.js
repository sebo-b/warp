"use strict";

function TransformController(mapWidth, mapHeight, spriteSize) {

    this.mapWidth = mapWidth;
    this.mapHeight = mapHeight;
    this.spriteSize = spriteSize;
    this.halfSprite = spriteSize / 2;

    this.active = false;
    this.handle = null;
    this.seats = [];
    this.initialPositions = [];
    this.initialBounds = null;
    this.pivot = null;
    this.lockIndex = -1;
    this.startX = 0;
    this.startY = 0;
    this.lastAngle = 0;
}

TransformController.prototype._maxX = function() {
    return this.mapWidth - this.spriteSize;
};

TransformController.prototype._maxY = function() {
    return this.mapHeight - this.spriteSize;
};

TransformController.prototype._applyAndClampAll = function(newPositions, lockPivot) {

    var n = this.seats.length;

    if (lockPivot) {
        for (var i = 0; i < n; i++) {
            if (i === this.lockIndex) {
                this.seats[i].silentSetXY(this.initialPositions[i][0], this.initialPositions[i][1]);
                continue;
            }
            this.seats[i].silentSetXY(
                Math.min(this._maxX(), Math.max(0, Math.round(newPositions[i][0]))),
                Math.min(this._maxY(), Math.max(0, Math.round(newPositions[i][1])))
            );
        }
        return;
    }

    var groupMinX = Infinity, groupMinY = Infinity;
    var groupMaxX = -Infinity, groupMaxY = -Infinity;

    for (var i = 0; i < n; i++) {
        var px = Math.round(newPositions[i][0]);
        var py = Math.round(newPositions[i][1]);
        newPositions[i][0] = px;
        newPositions[i][1] = py;
        if (px < groupMinX) groupMinX = px;
        if (py < groupMinY) groupMinY = py;
        if (px + this.spriteSize > groupMaxX) groupMaxX = px + this.spriteSize;
        if (py + this.spriteSize > groupMaxY) groupMaxY = py + this.spriteSize;
    }

    var shiftX = 0, shiftY = 0;

    if (groupMaxX - groupMinX <= this.mapWidth) {
        if (groupMinX < 0)
            shiftX = -groupMinX;
        if (groupMaxX + shiftX > this.mapWidth)
            shiftX = this.mapWidth - groupMaxX;
    }
    else if (groupMinX < 0) {
        shiftX = -groupMinX;
    }

    if (groupMaxY - groupMinY <= this.mapHeight) {
        if (groupMinY < 0)
            shiftY = -groupMinY;
        if (groupMaxY + shiftY > this.mapHeight)
            shiftY = this.mapHeight - groupMaxY;
    }
    else if (groupMinY < 0) {
        shiftY = -groupMinY;
    }

    for (var i = 0; i < n; i++) {
        this.seats[i].silentSetXY(
            Math.min(this._maxX(), Math.max(0, newPositions[i][0] + shiftX)),
            Math.min(this._maxY(), Math.max(0, newPositions[i][1] + shiftY))
        );
    }
};

TransformController.prototype._snapshot = function(seats, selectedSeat) {

    this.seats = seats;
    this.initialPositions = [];
    this.lockIndex = -1;

    var minX = Infinity, minY = Infinity;
    var maxX = -Infinity, maxY = -Infinity;

    for (var i = 0; i < seats.length; i++) {
        var s = seats[i];
        this.initialPositions.push([s.x, s.y]);
        if (s === selectedSeat)
            this.lockIndex = i;
        if (s.x < minX) minX = s.x;
        if (s.y < minY) minY = s.y;
        var right = s.x + this.spriteSize;
        var bottom = s.y + this.spriteSize;
        if (right > maxX) maxX = right;
        if (bottom > maxY) maxY = bottom;
    }

    this.initialBounds = {
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        cx: minX + (maxX - minX) / 2,
        cy: minY + (maxY - minY) / 2,
    };

    if (this.lockIndex >= 0) {
        var locked = this.initialPositions[this.lockIndex];
        this.pivot = {x: locked[0] + this.halfSprite, y: locked[1] + this.halfSprite};
    }
    else {
        this.pivot = {x: this.initialBounds.cx, y: this.initialBounds.cy};
    }
};

TransformController.prototype.begin = function(handle, seats, selectedSeat, px, py) {

    this.active = true;
    this.handle = handle;
    this.startX = px;
    this.startY = py;

    this._snapshot(seats, selectedSeat);
};

TransformController.prototype.drag = function(px, py) {

    if (!this.active)
        return;

    switch (this.handle) {
        case 'box': this._translate(px, py); break;
        case 'nw': this._scaleCorner('nw', px, py); break;
        case 'ne': this._scaleCorner('ne', px, py); break;
        case 'sw': this._scaleCorner('sw', px, py); break;
        case 'se': this._scaleCorner('se', px, py); break;
        case 'n': this._scaleEdge('n', py); break;
        case 's': this._scaleEdge('s', py); break;
        case 'e': this._scaleEdge('e', px); break;
        case 'w': this._scaleEdge('w', px); break;
        case 'rotate': this._rotate(px, py); break;
    }
};

TransformController.prototype.end = function() {

    this.active = false;
    this.handle = null;
    this.seats = [];
    this.initialPositions = [];
    this.initialBounds = null;
    this.pivot = null;
    this.lockIndex = -1;
};

TransformController.prototype._translate = function(px, py) {

    var dx = px - this.startX;
    var dy = py - this.startY;
    var n = this.seats.length;
    var newPos = new Array(n);

    for (var i = 0; i < n; i++) {
        var init = this.initialPositions[i];
        newPos[i] = [init[0] + dx, init[1] + dy];
    }

    this._applyAndClampAll(newPos, false);
};

TransformController.prototype._cornerPoint = function(corner) {

    var b = this.initialBounds;
    var h = this.halfSprite;
    var minCenterX = b.x + h;
    var maxCenterX = b.x + b.w - h;
    var minCenterY = b.y + h;
    var maxCenterY = b.y + b.h - h;
    var baseX, baseY, vx, vy;

    switch (corner) {
        case 'nw': baseX = this.pivot.x - h; baseY = this.pivot.y - h; vx = minCenterX - this.pivot.x; vy = minCenterY - this.pivot.y; break;
        case 'ne': baseX = this.pivot.x + h; baseY = this.pivot.y - h; vx = maxCenterX - this.pivot.x; vy = minCenterY - this.pivot.y; break;
        case 'sw': baseX = this.pivot.x - h; baseY = this.pivot.y + h; vx = minCenterX - this.pivot.x; vy = maxCenterY - this.pivot.y; break;
        case 'se': baseX = this.pivot.x + h; baseY = this.pivot.y + h; vx = maxCenterX - this.pivot.x; vy = maxCenterY - this.pivot.y; break;
    }

    return {baseX: baseX, baseY: baseY, vx: vx, vy: vy};
};

TransformController.prototype._scaleCorner = function(corner, px, py) {

    var c = this._cornerPoint(corner);
    var lenSq = c.vx * c.vx + c.vy * c.vy;
    if (lenSq < 1)
        return;

    var b = this.initialBounds;
    var cornerX, cornerY;
    switch (corner) {
        case 'nw': cornerX = b.x;       cornerY = b.y;       break;
        case 'ne': cornerX = b.x + b.w; cornerY = b.y;       break;
        case 'sw': cornerX = b.x;       cornerY = b.y + b.h; break;
        case 'se': cornerX = b.x + b.w; cornerY = b.y + b.h; break;
    }

    // Compensate for where in the handle the user clicked, so scale=1 at mousedown.
    var effPx = px - this.startX + cornerX;
    var effPy = py - this.startY + cornerY;

    var scale = ((effPx - c.baseX) * c.vx + (effPy - c.baseY) * c.vy) / lenSq;
    scale = Math.max(scale, 0.05);

    this._scaleFromPivot(scale, scale, true);
};

TransformController.prototype._scaleEdge = function(handle, coord) {

    var b = this.initialBounds;
    var h = this.halfSprite;
    var minCenterX = b.x + h;
    var maxCenterX = b.x + b.w - h;
    var minCenterY = b.y + h;
    var maxCenterY = b.y + b.h - h;
    var scale = 1;

    switch (handle) {
        case 'n': scale = (coord - (this.startY - b.y) + h - this.pivot.y) / (minCenterY - this.pivot.y); break;
        case 's': scale = (coord - (this.startY - (b.y + b.h)) - h - this.pivot.y) / (maxCenterY - this.pivot.y); break;
        case 'e': scale = (coord - (this.startX - (b.x + b.w)) - h - this.pivot.x) / (maxCenterX - this.pivot.x); break;
        case 'w': scale = (coord - (this.startX - b.x) + h - this.pivot.x) / (minCenterX - this.pivot.x); break;
    }

    if (!isFinite(scale))
        return;
    scale = Math.max(scale, 0.05);

    if (handle === 'n' || handle === 's')
        this._scaleFromPivot(1, scale, true);
    else
        this._scaleFromPivot(scale, 1, true);
};

TransformController.prototype._scaleFromPivot = function(scaleX, scaleY, lockPivot) {

    var n = this.seats.length;
    var newPos = new Array(n);

    for (var i = 0; i < n; i++) {
        var init = this.initialPositions[i];
        var cx = init[0] + this.halfSprite;
        var cy = init[1] + this.halfSprite;
        newPos[i] = [
            this.pivot.x + (cx - this.pivot.x) * scaleX - this.halfSprite,
            this.pivot.y + (cy - this.pivot.y) * scaleY - this.halfSprite,
        ];
    }

    this._applyAndClampAll(newPos, lockPivot && this.lockIndex >= 0);
};

TransformController.prototype._rotate = function(px, py) {

    var initAngle = Math.atan2(this.startY - this.pivot.y, this.startX - this.pivot.x);
    var curAngle = Math.atan2(py - this.pivot.y, px - this.pivot.x);
    var angle = curAngle - initAngle;

    if (angle > Math.PI)
        angle -= 2 * Math.PI;
    else if (angle <= -Math.PI)
        angle += 2 * Math.PI;

    this.lastAngle = angle;

    var cosA = Math.cos(angle);
    var sinA = Math.sin(angle);
    var n = this.seats.length;
    var newPos = new Array(n);

    for (var i = 0; i < n; i++) {
        var init = this.initialPositions[i];
        var cx = init[0] + this.halfSprite;
        var cy = init[1] + this.halfSprite;
        var relX = cx - this.pivot.x;
        var relY = cy - this.pivot.y;

        newPos[i] = [
            this.pivot.x + relX * cosA - relY * sinA - this.halfSprite,
            this.pivot.y + relX * sinA + relY * cosA - this.halfSprite,
        ];
    }

    this._applyAndClampAll(newPos, this.lockIndex >= 0);
};

export { TransformController as default, TransformController };
