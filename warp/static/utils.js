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

Utils.xhr = function(url,jsonData,toastOnSuccess = true, errorOnFailure = true) {
    return new Promise(function(resolve, reject) {

        let xhr = new XMLHttpRequest();
        xhr.addEventListener("load", function(e) {

            let resp;
            try {
                resp = JSON.parse(this.responseText);
            }
            catch (SyntaxError) {
                reject(400,null);
                return;
            }

            if (this.status == 200) {
                resolve({status:this.status, response: resp});
                if (toastOnSuccess)
                    M.toast({text: TR('Action successfull.')});
            }
            else {
                reject({status:this.status, response: resp});
                if (errorOnFailure) {
                    if ('code' in resp)
                        WarpModal.getInstance().open(TR("Error"),TR('Something went wrong (status=%{status}).',{status:resp.code}));
                    else
                        WarpModal.getInstance().open(TR("Error"),TR('Other error.'));
                }
            }
        });

        xhr.open("POST", url);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.send( JSON.stringify(jsonData));
    });
}