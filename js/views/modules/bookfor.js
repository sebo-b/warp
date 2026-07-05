'use strict';

import PlanUserData from "./planuserdata";

export default function BookFor() {

    if (typeof(BookFor.instance) !== 'undefined')
        throw Error('BookFor is a singleton');

    this.listeners = {
        init: new Set(),
        change: new Set()
    };

    this.changed = false;

    BookFor.instance = this;
}

BookFor.getInstance = function() {

    if (typeof(BookFor.instance) === 'undefined')
        return new BookFor();

    return BookFor.instance;
}

BookFor.prototype.on = function (type,listener) {

    if (type in this.listeners && typeof(listener) === 'function') {
        this.listeners[type].add(listener);

        // in case we finish loading before other modules register for load
        // we must fire listeners immediately
        if (type === "load" && ('selectedLogin' in this)) {
            listener.call(this,this);
        }
    }
}

// if skipMine this function will return null in case my login is selected
BookFor.prototype.getSelectedLogin = function(skipMine) {

    if (!('selectedLogin' in this))
        throw Error("BookFor not initialized")

    if (skipMine && this.zoneUserData.whoami() === this.selectedLogin)
        return null;

    return this.selectedLogin;
}

BookFor.prototype._setSelectedLogin = function(login) {

    if (!('selectedLogin' in this))
        throw Error("BookFor not initialized")

    if (!(login in this.zoneUserData.data))
        login = this.zoneUserData.whoami();

    if (this.selectedLogin !== login) {
        this.selectedLogin = login;
        this.changed = true;
    }
}

BookFor.prototype._callChangeListeners = function() {

    if (this.changed) {
        for (let l of this.listeners['change'])
            l.call(this,this.selectedLogin,this);
        this.changed = false;
    }

}

BookFor.prototype._onBlur = function(e) {

    let target = e.target;

    let autocomplete = M.Autocomplete.getInstance(target);
    if (autocomplete.dropdown.isOpen)
        return;

    if (!(target.value in autocomplete.options.data)) {
        target.value = this.zoneUserData.makeUserStr(this.selectedLogin);
        document.querySelector("label[for=" + target.id + "]").classList.add('active');
    }
}

BookFor.prototype._onAutocomplete = function(el,sel) {

    var login = PlanUserData.makeUserStrRev(sel);
    this._setSelectedLogin(login);

    this._callChangeListeners();
}

BookFor.prototype._onKeyUp = function(e) {

    let target = e.target;

    if (e.keyCode === 13 && target.value === "") {
        this._setSelectedLogin(this.zoneUserData.whoami());
        target.blur();
        this._callChangeListeners();
    }
    else if (e.keyCode == 27) {
        target.value = "";
        target.blur();
    }
}

BookFor.prototype._init =  function(zoneUserData) {

    if ('selectedLogin' in this)
        throw Error("BookFor can be initialized only once")

    this.zoneUserData = zoneUserData;
    this.selectedLogin = this.zoneUserData.whoami();

    this.bookForData = {};
    for (let d of this.zoneUserData.formatedIterator()) {
        this.bookForData[ d] = null;
    }

    this.autocompleteInstances = [];

    var bookForElements = document.getElementsByClassName('book-for_input');
    for (let el of bookForElements) {
        this.autocompleteInstances.push( M.Autocomplete.init(el, {
            data: this.bookForData,
            dropdownOptions: {
                constrainWidth: false,
                container: document.body
            },
            minLength: 1,
            onAutocomplete: this._onAutocomplete.bind(this,el)
        }));
    }

    for (let el of bookForElements) {
        this._onBlur({target: el});   // show selectedLoginStr
        el.addEventListener('blur',this._onBlur.bind(this));
        el.addEventListener('keyup',this._onKeyUp.bind(this));
        el.addEventListener('focus', function() {this.select(); })
    }

    for (let l of this.listeners['init']) {
        l.call(this,this);
    }
}

// Clears this singleton's per-mount state (the plan view's unmount() calls
// this) so _init() can run again on the next admin plan mount instead of
// throwing "can be initialized only once". Its book-for_input DOM elements are
// gone already (router.js replaces #view-root wholesale) but their Materialize
// Autocomplete dropdown panels are appended to document.body — outside
// #view-root — so they'd leak across navigations without an explicit destroy.
// Also clears 'change'/'init' listeners: each plan mount's initBookFor()
// registers its own; left stale, a second mount would fire the FIRST mount's
// listener too, calling seatFactory.setLogin() on an abandoned factory.
BookFor.prototype.reset = function() {
    if (this.autocompleteInstances) {
        for (let inst of this.autocompleteInstances) {
            if (inst && typeof inst.destroy === 'function') inst.destroy();
        }
    }
    delete this.selectedLogin;
    delete this.zoneUserData;
    delete this.bookForData;
    delete this.autocompleteInstances;
    this.changed = false;
    this.listeners['init'].clear();
    this.listeners['change'].clear();
}

PlanUserData.getInstance().on('load',function(zoneUserData) {
    BookFor.getInstance()._init(zoneUserData);
    });
