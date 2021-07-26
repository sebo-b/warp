'use strict';

var actAsData = {};

function actAsChange(e) {

    // e is undefined during initialization (not fired by event)
    var sel = e? this.value: null;

    var reload = false;

    if (sel == "") {

        if (actAsData.selected != actAsData.default) {
            actAsData.selected = actAsData.default;
            reload = true;
        }
        
        this.value = actAsData.selected;
        document.querySelector("label[for='act-as']").classList.add('active');
    }
    else if (sel in actAsData.data) {
        if (actAsData.selected != sel) {
            actAsData.selected = sel;
            reload = true;
        }
    }
    else {
        this.value = actAsData.selected;
        document.querySelector("label[for='act-as']").classList.add('active');
    }

    if (reload) {
        
        const regEx = /\[([^[]*)\]$/;
        var login = actAsData.selected.match(regEx);

        if (login) {

            var action_data = {
                "login": login[1]
            };

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

function initActAs() {

    var actAsContainerEl = document.getElementById('act-as-container');
    var actAsEl = document.getElementById('act-as');
    var actAs = M.Autocomplete.init(actAsEl, { 
        minLength: 0
    });

    var xhr = new XMLHttpRequest();
    xhr.addEventListener("load", function() {

        actAsData = JSON.parse(this.responseText);

        actAs.updateData(actAsData.data);
        actAsChange.call(actAsEl);  //don't pass event to initialize
        actAsEl.addEventListener('change',actAsChange);
        actAsEl.addEventListener('focus', function() {this.select(); })
        actAsContainerEl.style.display = "block";
    });

    xhr.open("GET", actAsGetURL);
    xhr.send();

}


window.addEventListener("load",initActAs)