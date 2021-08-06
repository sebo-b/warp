'use strict';

var g_userData; // used by actAs and assigned seat

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
            xhr.open("POST", actAsSetURL);
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
            document.querySelector("label[for='act-as']").classList.add('active');
        }
    }

    var onKeyUp = function(e) {

        if (e.keyCode === 13 && this.value === "") {
            if (selectedLoginStr == realLoginStr)
                this.blur();
            else
                onAutocomplete(
                    actAsUserStr(g_userData.real_login, g_userData.data[g_userData.real_login]));
        }
        else if (e.keyCode == 27) {
            this.blur();
        }
    }

    var actAsContainerEl = document.getElementById('act-as-container');
    var actAsEl = document.getElementById('act-as');
    var actAs = M.Autocomplete.init(actAsEl, { 
        minLength: 1,
        onAutocomplete: onAutocomplete
    });

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        g_userData = JSON.parse(this.responseText);

        selectedLoginStr = 
            actAsUserStr(g_userData.login, g_userData.data[g_userData.login]);

        realLoginStr = 
            actAsUserStr(g_userData.real_login, g_userData.data[g_userData.real_login]);

        var actAsData = {};
        for (let login in g_userData.data) {
            var userName = g_userData.data[login];
            actAsData[ actAsUserStr(login,userName)] = null;
        }

        actAs.updateData(actAsData);
        onBlur.call(actAsEl);   // show selectedLoginStr
        actAsEl.addEventListener('blur',onBlur);
        actAsEl.addEventListener('keyup',onKeyUp);
        actAsEl.addEventListener('focus', function() {this.select(); })
    
        actAsContainerEl.style.display = "block";
    });

    xhr.open("GET", getUsersURL);
    xhr.send();

}


window.addEventListener("load",initActAs)