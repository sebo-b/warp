'use strict';

import Utils from "./utils";

export default function ZoneUserData() {

    this.__data = null;
    this.listeners = {
        load: new Set()
    };
}

Object.defineProperty(ZoneUserData.prototype, "data", {
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



ZoneUserData.makeUserStr = function(login,name) {
    return  name + " ["+login+"]";
};

ZoneUserData.makeUserStrRev = function (str) {
    const regEx = /\[([^[]*)\]$/;
    var login = str.match(regEx);

    if (login !== null)
        return login[1];

    throw Error("Unknown login");
};


ZoneUserData.getInstance = function() {

    if (typeof(ZoneUserData.instance) === 'undefined') {
        ZoneUserData.instance = new ZoneUserData();
    }

    return ZoneUserData.instance;
}

ZoneUserData.prototype.getData = function() {

    return this.data;
}

ZoneUserData.prototype.formatedIterator = function*() {

    for (let login in this.data) {
        yield ZoneUserData.makeUserStr(login, this.data[login]);
    }
}

// this is just a shortcut function to warp globals
ZoneUserData.prototype.whoami = function() {
    let login = window.warpGlobals.login;
    if (typeof(login) === 'undefined')
        throw Error('document.warpGlobals.login not defined');

    return login;
}

ZoneUserData.prototype.makeUserStr = function(login) {

    return ZoneUserData.makeUserStr( login, this.data[login]);
}

ZoneUserData.prototype.makeUserStrRev = function (str) {

    let login = ZoneUserData.makeUserStrRev(str);
    if (!(login in this.data))
        return null;

    return login;
}

// TODO switch to Utils.listeners
ZoneUserData.prototype.on = function (type,listener) {

    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);

        // in case we finish loading before other modules register for load
        // we must fire listeners immediately
        if (type === "load" && this.__data) {
            listener.call(this,this);
        }
    }
}

ZoneUserData.init = function() {

    Utils.xhr.get(
        window.warpGlobals.URLs['zoneGetUsers'],
        {toastOnSuccess:false})
    .then( (e) => {
        ZoneUserData.getInstance().data = e.response;
    })
}
