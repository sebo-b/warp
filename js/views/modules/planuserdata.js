'use strict';

import Utils from "./utils";

export default function PlanUserData() {

    this.__data = null;
    this.listeners = {
        load: new Set()
    };
}

Object.defineProperty(PlanUserData.prototype, "data", {
    get: function() {

        if (!this.__data)
            throw Error("UserData not initialized.");

        return this.__data;
    },
    set: function(v) {

        if (this.__data)
            throw Error("UserData already initialized.");

        this.__data = v;
        for (let l of this.listeners['load'])
            l.call(this,this);
    }
});



PlanUserData.makeUserStr = function(login,name) {
    return  name + " ["+login+"]";
};

PlanUserData.makeUserStrRev = function (str) {
    const regEx = /\[([^[]*)\]$/;
    var login = str.match(regEx);

    if (login !== null)
        return login[1];

    throw Error("Unknown login");
};


PlanUserData.getInstance = function() {

    if (typeof(PlanUserData.instance) === 'undefined') {
        PlanUserData.instance = new PlanUserData();
    }

    return PlanUserData.instance;
}

PlanUserData.prototype.getData = function() {

    return this.data;
}

// Clears loaded data so init() can reload it on a fresh SPA mount (the plan
// view's unmount() calls this). Deliberately keeps this.listeners — bookas.js
// wires BookAs to the 'load' event once, at module-import time, against this
// same singleton instance; replacing the instance instead of resetting it
// would orphan that wiring.
// Bumps the init generation so an in-flight PlanUserData.init() from a previous
// mount drops its response instead of installing the old plan's user list into
// the new mount's singleton (the plan A -> plan B fast-switch race).
var initGen = 0;
PlanUserData.prototype.reset = function() {
    this.__data = null;
    initGen++;
}

PlanUserData.prototype.formatedIterator = function*() {

    for (let login in this.data) {
        yield PlanUserData.makeUserStr(login, this.data[login]);
    }
}

// this is just a shortcut function to warp globals
PlanUserData.prototype.whoami = function() {
    let login = window.warpGlobals.login;
    if (typeof(login) === 'undefined')
        throw Error('document.warpGlobals.login not defined');

    return login;
}

PlanUserData.prototype.makeUserStr = function(login) {

    return PlanUserData.makeUserStr( login, this.data[login]);
}

PlanUserData.prototype.makeUserStrRev = function (str) {

    let login = PlanUserData.makeUserStrRev(str);
    if (!(login in this.data))
        return null;

    return login;
}

// TODO switch to Utils.listeners
PlanUserData.prototype.on = function (type,listener) {

    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);

        // in case we finish loading before other modules register for load
        // we must fire listeners immediately
        if (type === "load" && this.__data) {
            listener.call(this,this);
        }
    }
}

PlanUserData.init = function() {

    // Generation token: a newer init() or a reset() (mount unmount) invalidates
    // this call, so a stale getUsers response from a previous plan can't poison
    // the current mount's singleton (and can't throw "already initialized" as an
    // unhandled rejection when the newer mount already installed its data).
    var gen = ++initGen;
    Utils.xhr.get(
        window.warpGlobals.URLs['planGetUsers'],
        {toastOnSuccess:false})
    .then( (e) => {
        if (gen !== initGen) return;   // superseded by a newer init() / reset()
        PlanUserData.getInstance().data = e.response;
    })
    .catch( () => {} );   // fire-and-forget: never surface an unhandled rejection
}
