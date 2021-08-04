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

    var actAsContainerEl = document.getElementById('act-as-container');
    var actAsEl = document.getElementById('act-as');
    var actAs = M.Autocomplete.init(actAsEl, { 
        minLength: 0
    });

    var selectedLoginStr;
    var realLoginStr;

    var actAsChange = function(e) {

        // e is undefined during initialization (not fired by event)
        var sel = e? this.value: null;
    
        var reload = false;
    
        if (sel == "") {
    
            if (selectedLoginStr != realLoginStr) {
                selectedLoginStr = realLoginStr;
                reload = true;
            }

            this.value = selectedLoginStr;
            document.querySelector("label[for='act-as']").classList.add('active');
            
        }
        else if (sel in actAs.options.data) {
            if (selectedLoginStr != sel) {
                selectedLoginStr = sel;
                reload = true;
            }
        }
        else {
            this.value = selectedLoginStr;
            document.querySelector("label[for='act-as']").classList.add('active');
        }
    
        if (reload) {

            var login = actAsUserStrRev(selectedLoginStr);
    
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
    }

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
        actAsChange.call(actAsEl);  //don't pass event to initialize
        actAsEl.addEventListener('change',actAsChange);
        actAsEl.addEventListener('focus', function() {this.select(); })
        actAsContainerEl.style.display = "block";
    });

    xhr.open("GET", getUsersURL);
    xhr.send();

}


window.addEventListener("load",initActAs)