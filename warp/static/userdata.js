'use strict';

function UserData() {

    this.listeners = { 
        load: new Set() 
    };
}

UserData.Roles = {
    0: "Überadmin",
    1: "Admin",
    2: "User",
    3: "Viewer",
    100: "BLOCKED"
};

UserData.getInstance = function() {

    if (typeof(UserData.instance) === 'undefined') {
        UserData.instance = new UserData();
    }
    
    return UserData.instance;
}

UserData.formatRole = function(role) {

    if (!(role in UserData.Roles)) {
        return "UNKNOWN";
    }

    return UserData.Roles[role];
}

UserData.prototype.getData = function() {

    if (!this.data)
        throw Error("UserData not initialized.");

    return this.data;
}

UserData.prototype.getLogin = function() {
    if (!this.data)
        throw Error("UserData not initialized.");

    return this.login;
}

UserData.prototype.getRealLogin = function() {
    if (!this.data)
        throw Error("UserData not initialized.");

    return this.realLogin;
}

UserData.prototype.isDirty = function() {

    if (!this.data)
        return true;

    return !(this.login in this.data);
}

UserData.prototype.getRole = function() {

    if (!this.data)
        throw Error("UserData not initialized.");

    return this.role;
}

UserData.prototype.makeUserStr = function(login) {

    if (typeof(login) === 'undefined')
        login = this.login;

    if (!this.data || !(login in this.data))
        return login;

    return  this.data[login].name + " ["+login+"]";
};

UserData.prototype.makeUserStrRev = function (str) {
    const regEx = /\[([^[]*)\]$/;
    var login = str.match(regEx);
    
    if (typeof(login) == 'array' && login[1] in this.data)
        return login[1];

    if (str in this.data)
        return str;

    throw Error("Unknown login");
};

UserData.prototype.on = function (type,listener) {

    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);

        // in case we finish loading before other modules register for load
        // we must fire listeners immediately
        if (type === "load" && typeof(this.data) !== 'undefined') {
            listener.call(this,this);
        }
    }
}

UserData.prototype.updateOrAddData = function(newData) {
    Object.assign(this.data, newData)
}

UserData.prototype.delete = function(logins) {
    if (typeof(logins) === 'string')
        logins = [ login ];

    for (let l of logins) {
        delete this.data[l];
    }
}


UserData.prototype._init = function() {

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", (e) => {
        
        var respJSON = JSON.parse(e.currentTarget.responseText);

        this.data = respJSON.data;
        this.login = respJSON.login;
        this.realLogin = respJSON.real_login;
        this.role = respJSON.role;

        for (let l of this.listeners['load']) {
            l.call(this,this);
        }
    });

    xhr.open("GET", window.warpGlobals.URLs['getUsers']);
    xhr.send();
}


document.addEventListener("DOMContentLoaded", function() { UserData.getInstance()._init(); } );