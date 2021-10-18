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