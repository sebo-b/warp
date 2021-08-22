'use strict';

function actAsUserStr(login,name) {
    return  name + " ["+login+"]";
};

function actAsUserStrRev(str) {
    const regEx = /\[([^[]*)\]$/;
    var login = str.match(regEx);
    
    return login? login[1]: null;
};


function initActAs() {

    var selectedLoginStr;
    var realLoginStr;

    var onAutocomplete = function(sel) {

        if (selectedLoginStr == sel)
            return;
        
        var login = actAsUserStrRev(sel);

        if (login) {

            var action_data = { login: login };

            var xhr = new XMLHttpRequest();
            xhr.addEventListener("load", function() {
                window.location.reload();
            });
            xhr.open("POST", window.warpGlobals.URLs['actAsSet']);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.send( JSON.stringify(action_data));
        }
    }

    var onBlur = function(e) {

        let actAs = M.Autocomplete.getInstance(this);
        if (actAs.dropdown.isOpen)
            return;

        if (!(this.value in actAs.options.data)) {
            this.value = selectedLoginStr;
            document.querySelector("label[for=" + this.id + "]").classList.add('active');
        }
    }

    var onKeyUp = function(e) {

        if (e.keyCode === 13 && this.value === "") {
            if (selectedLoginStr == realLoginStr)
                this.blur();
            else
                onAutocomplete(
                    actAsUserStr(
                        window.warpGlobals.URLs['userData'].real_login, 
                        window.warpGlobals.URLs['userData'].data[window.warpGlobals.URLs['userData'].real_login]));
        }
        else if (e.keyCode == 27) {
            this.blur();
        }
    }

    // getElementsByClassName cannot be used as it has to be a NodeList not a HTMLCollection
    var actAsElements = document.querySelectorAll('.act-as-input'); 
    var actAsInstances = M.Autocomplete.init(actAsElements, { 
        minLength: 1,
        onAutocomplete: onAutocomplete
    });

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        window.warpGlobals.URLs['userData'] = JSON.parse(this.responseText);

        selectedLoginStr = 
            actAsUserStr(window.warpGlobals.URLs['userData'].login, window.warpGlobals.URLs['userData'].data[window.warpGlobals.URLs['userData'].login]);

        realLoginStr = 
            actAsUserStr(window.warpGlobals.URLs['userData'].real_login, window.warpGlobals.URLs['userData'].data[window.warpGlobals.URLs['userData'].real_login]);

        var actAsData = {};
        for (let login in window.warpGlobals.URLs['userData'].data) {
            var userName = window.warpGlobals.URLs['userData'].data[login];
            actAsData[ actAsUserStr(login,userName)] = null;
        }

        for (let i of actAsInstances) {
            i.updateData(actAsData);
        }

        for (let e of actAsElements) {
            onBlur.call(e);   // show selectedLoginStr
            e.addEventListener('blur',onBlur);
            e.addEventListener('keyup',onKeyUp);
            e.addEventListener('focus', function() {this.select(); })
        }
    
        var actAsContainers = document.getElementsByClassName("act-as-container");
        for (let c of actAsContainers) {
            c.style.display = "block";
        }
    });

    xhr.open("GET", window.warpGlobals.URLs['getUsers']);
    xhr.send();

}


window.addEventListener("load",initActAs)