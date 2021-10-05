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


//ZoneUserData.prototype.makeUserStr = function(login) {
//
//    if (typeof(login) === 'undefined')
//        login = this.login;
//
//    if (!this.data || !(login in this.data))
//        return login;
//
//    return  this.data[login].name + " ["+login+"]";
//};
//
//ZoneUserData.prototype.makeUserStrRev = function (str) {
//    const regEx = /\[([^[]*)\]$/;
//    var login = str.match(regEx);
//
//    if (login !== null && login[1] in this.data)
//        return login[1];
//
//    if (str in this.data)
//        return str;
//
//    throw Error("Unknown login");
//};

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

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", (e) => {

        var respJSON = JSON.parse(e.currentTarget.responseText);

        this.data = respJSON;

        for (let l of this.listeners['load']) {
            l.call(this,this);
        }
    });

    xhr.open("GET", window.warpGlobals.URLs['zoneGetUsers']);
    xhr.send();
}


document.addEventListener("DOMContentLoaded", function() { ZoneUserData.getInstance()._init(); } );