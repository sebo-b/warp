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

    Utils.xhr.get(
        window.warpGlobals.URLs['planGetUsers'],
        {toastOnSuccess:false})
    .then( (e) => {
        PlanUserData.getInstance().data = e.response;
    })
}
