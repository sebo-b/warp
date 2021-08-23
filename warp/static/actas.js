'use strict';

if (typeof(UserData) === 'undefined')
    throw Error('actas requires userdata module');

function initActAs(userData) {

    var selectedLoginStr;
    var realLoginStr;

    var onAutocomplete = function(sel) {

        if (selectedLoginStr == sel)
            return;
        
        var login = userData.makeUserStrRev(sel);

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
                    userData.makeUserStr(userData.getRealLogin()));
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

    selectedLoginStr = 
        userData.makeUserStr();

    realLoginStr = 
        userData.makeUserStr(userData.getRealLogin());

    var actAsData = {};
    for (let login in userData.getData()) {
        actAsData[ userData.makeUserStr(login)] = null;
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
}

UserData.getInstance().on('load',initActAs);
