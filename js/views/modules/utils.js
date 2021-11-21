'use strict';

import WarpModal from './modal.js';

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
    _counter: 0,
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
            let spinnerEl = document.getElementById('spinner');

            xhr.addEventListener("loadstart", () => {
                if (this._counter++ == 0) {
                    spinnerEl.classList.add('active');
                }
            });

            xhr.addEventListener("loadend", () => {
                if (--this._counter == 0) {
                    spinnerEl.classList.remove('active');
                }
            });

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

