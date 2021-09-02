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

    var actAsInstances = [];
    var actAsElements = document.getElementsByClassName('act-as-input'); 
    for (let el of actAsElements) {
        let i = M.Autocomplete.getInstance(el);
        if (!i) {
            i = M.Autocomplete.init(el, { 
                    dropdownOptions: { 
                        constrainWidth: false, 
                        container: document.body 
                    },
                    minLength: 1,
                    onAutocomplete: onAutocomplete
                });
        }
        else if (userData.isDirty()) {  // in case current login was deleted, we need to reload
            onAutocomplete(userData.getRealLogin());
            return;
        }
        actAsInstances.push(i);
    }

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
