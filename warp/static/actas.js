'use strict';

function initActAs() {

    var actAsContainerEl = document.getElementById('act-as-container');
    var actAsEl = document.getElementById('act-as');
    var actAs = M.Autocomplete.init(actAsEl, { 
        minLength: 0
    });

    var selectedLoginStr;
    var realLoginStr;

    var userStr = function(login,name) {
        return  name + " ["+login+"]";
    };

    var userStrRev = function(str) {
        const regEx = /\[([^[]*)\]$/;
        var login = str.match(regEx);
        
        return login? login[1]: null;
    };

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

            var login = userStrRev(selectedLoginStr);
    
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

        var userData = JSON.parse(this.responseText);

        selectedLoginStr = 
            userStr(userData.login, userData.data[userData.login]);
        
        realLoginStr =
            userStr(userData.real_login, userData.data[userData.real_login]);

        var actAsData = {};
        for (let login in userData.data) {
            var userName = userData.data[login];
            actAsData[ userStr(login,userName)] = null;
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