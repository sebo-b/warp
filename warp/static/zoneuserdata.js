'use strict';

function ZoneUserData() {

    this.listeners = {
        load: new Set()
    };
}

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

    if (!this.data)
        throw Error("UserData not initialized.");

    return this.data;
}

ZoneUserData.prototype.formatedIterator = function*() {

    if (!this.data)
        throw Error("UserData not initialized.");

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

    if (!(login in this.data))
        throw Error('Unknown login');

    return ZoneUserData.makeUserStr( login, this.data[login]);
}

ZoneUserData.prototype.makeUserStrRev = function (str) {

    let login = ZoneUserData.makeUserStrRev(str);
    if (!(login in this.data))
        return null;

    return login;
}

ZoneUserData.prototype.on = function (type,listener) {

    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);

        // in case we finish loading before other modules register for load
        // we must fire listeners immediately
        if (type === "load" && typeof(this.data) !== 'undefined') {
            listener.call(this,this);
        }
    }
}

ZoneUserData.prototype._init = function() {

    Utils.xhr.get(
        window.warpGlobals.URLs['zoneGetUsers'],
        {toastOnSuccess:false})
    .then( (e) => {
        this.data = e.response;
        for (let l of this.listeners['load']) {
            l.call(this,this);
        }
    })
}


document.addEventListener("DOMContentLoaded", function() { ZoneUserData.getInstance()._init(); } );