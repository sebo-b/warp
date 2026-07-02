'use strict';

import WarpModal from './modal.js';
// Shared ref-counted spinner (app/spinner.js) — the SAME counter the router
// uses for view transitions. Keeping one counter across XHRs and transitions
// means a transition that fires XHRs doesn't let the XHR's loadend drop the
// spinner to 0 (and flicker it off) while the transition is still building the
// view. Replaces the per-XHR _counter this module used to keep.
import { acquire as spinnerAcquire, release as spinnerRelease } from '../../app/spinner.js';

export default function Utils() {
}

//TODO_X: remove the same from ZoneUserData
Utils.makeUserStr = function(login,name) {
    return  name + " ["+login+"]";
};

Utils.makeUserStrRev = function (str) {
    const regEx = /(.*) \[([^[]*)\]$/;
    var login = str.match(regEx);

    if (login !== null)
        return [login[2],login[1]];

    throw Error("Unknown login");
};

// One-shot debounce for the 401 -> login redirect: the first expired-session
// XHR flips the flag and does the full-page navigate; every parallel 401 that
// lands while that navigate is pending sees the flag and is dropped, so the
// user gets a single redirect instead of N error modals / N navigations.
Utils._sessionExpiredRedirecting = false;
Utils._maybeRedirectOnSessionExpired = function(response) {
    if (Utils._sessionExpiredRedirecting) return true;
    if (response && typeof response === 'object' && response.code === 'SESSION_EXPIRED') {
        Utils._sessionExpiredRedirecting = true;
        var loginUrl = window.warpGlobals && window.warpGlobals.URLs && window.warpGlobals.URLs.login;
        if (loginUrl) window.location.assign(loginUrl);
        return true;
    }
    return false;
};

Utils.formatError = function(status, response) {

    if (status === 200)
        throw Error("Status 200 is not an error");

    if (response instanceof Object && 'code' in response) {
        if (TR.has("errorCode."+response.code)) {
            return TR("errorCode."+response.code,{code: response.code});
        }
        else if (status == 403) {
            return TR("errorCode.Forbidden (%{code})",{code: response.code});
        }
        else {
            return TR("errorCode.Other error. (status=%{status} code=%{code})",{status: status, code: response.code});
        }
    }
    else {
        return TR("errorCode.Other error. (status=%{status})",{status: status});
    }

}

Utils.xhr = {
    _defaultOptions: {
        toastOnSuccess: true,
        errorOnFailure: true,
    },

    post: function(url,data,options = null) {
        let opt = Object.assign(
            {},
            this._defaultOptions,
            options,
            {url: url, data: data, type: "POST" });

        return this._xhr(opt);
    },

    get: function(url,options = null) {
        let opt = Object.assign(
            {},
            this._defaultOptions,
            options,
            {url: url, data: undefined, type: "GET" });

        return this._xhr(opt);
    },

    _xhr: function(opt) {

        return new Promise( (resolve, reject) => {

            let xhr = new XMLHttpRequest();

            xhr.addEventListener("loadstart", () => spinnerAcquire());
            xhr.addEventListener("loadend",   () => spinnerRelease());

            xhr.addEventListener("load", function(e) {

                let contentType = this.getResponseHeader("Content-Type");
                let content = this.response;

                try {
                    if (contentType.startsWith('application/json')) {
                        let decoder = new TextDecoder('utf-8');
                        content = JSON.parse(decoder.decode(content));
                    }
                    else if (contentType.startsWith('text')) {
                        let decoder = new TextDecoder('utf-8');
                        content = decoder.decode(content);
                    }
                    else {
                        content = new Blob([content],{type:contentType});
                    }
                }
                catch (e) {
                    //ignore
                }

                if (this.status == 200) {
                    resolve({status:this.status, response: content, requestObject: this});
                    if (opt.toastOnSuccess)
                        M.toast({text: TR('Action successfull.')});
                }
                else {
                    // Session expired: the SPA can't follow a login redirect
                    // from inside an XHR (it would land the raw login HTML in
                    // the fetch response), so warp/auth.py returns 401 JSON
                    // {code:'SESSION_EXPIRED'} for /xhr/* — do ONE full-page
                    // navigate to the login route, debounced so a burst of
                    // parallel failing XHRs triggers a single redirect.
                    if (this.status == 401 && Utils._maybeRedirectOnSessionExpired(content)) {
                        reject({status:this.status, response: content, requestObject: this, errorMsg: ''});
                        return;
                    }
                    let errorMsg = Utils.formatError(this.status,content);
                    reject({status:this.status, response: content, requestObject: this, errorMsg: errorMsg});
                    if (opt.errorOnFailure) {
                        WarpModal.getInstance().open(TR("Error"),errorMsg);
                    }
                }
            });

            xhr.addEventListener("error", function(e) {
                reject({status: 418, response: {}, requestObject: this, errorMsg: Utils.formatError(418,null)});
            });

            xhr.open(opt.type, opt.url);

            let data = opt.data;
            if (!(data instanceof FormData)) {
                data = JSON.stringify(data);
                xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            }

            xhr.responseType = 'arraybuffer';
            xhr.send(data);
        });
    },
};


// Returns a Tabulator 6 callback that renders a native <select> dropdown.
// Usable as both `headerFilter:` and `editor:` — auto-detects context via cell.getType().
// Replaces editor:"list" / headerFilter:"select" which don't interop with Materialize.
// In header-filter mode, entries without a `value` (e.g. a leading {label:"---"} placeholder)
// render as a "clear filter" option; in editor mode they are skipped.
Utils.makeSelect = function(values) {
    return function(cell, onRendered, success, cancel, editorParams) {
        var isFilter = cell.getType() === "header";

        var select = document.createElement("select");
        select.className = "warp_select";

        for (let v of values) {
            if (v.value === undefined && !isFilter) continue;
            var opt = document.createElement("option");
            opt.value = v.value !== undefined ? v.value : "";
            opt.textContent = v.label;
            select.appendChild(opt);
        }

        if (!isFilter)
            select.value = String(cell.getValue());

        select.addEventListener("change", function() {
            var raw = select.value;
            if (isFilter && raw === "") { success(""); return; }
            var matched = values.find(v => String(v.value) === raw);
            success(matched ? matched.value : raw);
        });

        if (!isFilter) {
            var resolved = false;
            select.addEventListener("change", function() { resolved = true; });
            select.addEventListener("blur", function() { if (!resolved) cancel(); });
            onRendered(function() { select.focus(); });
        }

        return select;
    };
};

Utils.Listeners = function(types, async = true) {

    this.async = async;

    this.listeners = {};
    for (let t of types)
        this.listeners[t] = new Set();

    this.on = function(type,listener) {
        if (type in this.listeners && typeof(listener) === 'function') {
            this.listeners[type].add(listener);
        }
    };

    this.off = function(type,listener = null) {
        if (!type in this.listeners)
            return;

        if (listener == null)
            this.listeners[type].clear();
        else
            this.listeners[type].delete(listener);
    }

    this.fireEvent = function(type,_this,param) {

        if (this.async) {
            for (let i of this.listeners[type]) {
                setTimeout(i.bind(_this),0,param);
            }
        }
        else {
            for (let i of this.listeners[type]) {
                i.call(this,param);
            }
        }
    }

}

