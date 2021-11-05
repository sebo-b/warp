'use strict';

function Utils() {
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

Utils.xhr = function(url,jsonData,toastOnSuccess = true, errorOnFailure = true, responseType = "json") {
    return new Promise(function(resolve, reject) {

        let xhr = new XMLHttpRequest();
        xhr.addEventListener("load", function(e) {

            if (this.status == 200 && this.response !== null) {
                resolve({status:this.status, response: this.response, requestObject: this});
                if (toastOnSuccess)
                    M.toast({text: TR('Action successfull.')});
            }
            else {
                reject({status:this.status, response: this.response, requestObject: this});
                if (errorOnFailure) {
                    if (this.response !== null && typeof(this.response) === 'object' && 'code' in this.response)
                        WarpModal.getInstance().open(TR("Error"),TR('Something went wrong (status=%{status}).',{status:this.response.code}));
                    else
                        WarpModal.getInstance().open(TR("Error"),TR('Other error.'));
                }
            }
        });

        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.responseType = responseType;
        xhr.send( JSON.stringify(jsonData));
    });
}