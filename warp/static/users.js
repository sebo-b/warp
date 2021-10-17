"use strict";

document.addEventListener("DOMContentLoaded", function(e) {

    let accountTypes = [
        {label: "---" },
        {label: "Admin", value: 10 },
        {label: "User", value: 20 },
        {label: "BLOCKED", value: 90 }
    ];
    let defaultAccountType = 20;

    var showEditDialog;

    var accountTypeFormatter = function(cell, formatterParams) {
        let value = cell.getValue();
        for (let i of accountTypes) {
            if (i['value'] == value)
                return i['label'];
        }
        return accountTypes[0]['label'];
    }

    var editFormater = function(cell) {
        return '<div class="edit_icon"></div>';
    }

    var editClicked = function(e,cell) {
        let data = cell.getRow().getData();
        showEditDialog(data.login, data.account_type, data.name);
    }

    var table = new Tabulator("#usersTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['usersList'],
        index:"login",
        layout:"fitDataFill",
        resizableColumns:true,
        pagination: 'remote',
        ajaxSorting:true,
        ajaxFiltering:true,
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: [
            {formatter:editFormater, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
            {title:"Login", field: "login", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Name", field: "name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Type", field: "account_type", headerFilter:"select", headerFilterFunc:"=", headerFilterParams:{ values: accountTypes }, formatter:accountTypeFormatter  }
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"Name", dir:"asc"}
        ]
    });

    showEditDialog = function(login,account_type,name) {

        var editModalEl = document.getElementById('edit_modal');
        var editModal = M.Modal.getInstance(editModalEl);

        var loginEl = document.getElementById("login");
        var nameEl = document.getElementById("name");
        var accountTypeSelectEl = document.getElementById('account_type_select');
        var password1El = document.getElementById('password');
        var password2El = document.getElementById('password2');

        var saveBtn = document.getElementById('edit_modal_save_btn');
        var deleteBtn = document.getElementById('edit_modal_delete_btn');

        var errorDiv = document.getElementById("error_div");
        var errorMsg = document.getElementById("error_message");

        if (typeof(editModal) === 'undefined') {

            editModal = M.Modal.init(editModalEl, {
                onCloseEnd: function() {
                    // we need to tear down materialize select and recreate it
                    // as there is no (exposed) API to select the option
                    let accountTypeSelect = M.FormSelect.getInstance(accountTypeSelectEl);
                    if (accountTypeSelect) {
                        accountTypeSelect.destroy();
                        accountTypeSelectEl.innerHTML = "";
                    }
                }
            });

            var showPassBtns = document.getElementsByClassName('show_password_btn');
            for (let b of showPassBtns) {
                let input = b.parentNode.getElementsByTagName('INPUT')[0];
                b.addEventListener('click', function(e){
                    input.type = input.type == "text"? "password": "text";
                })
            }

            document.getElementById('generate_password_btn').addEventListener('click', function(e) {
                let array = new Uint8Array(10);
                window.crypto.getRandomValues(array);

                let res = new String();
                let validChars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz!#$%&*+-:;<=>?@^|";
                for (let i of array) {
                    res = res + validChars[ i % validChars.length ];
                }

                password1El.value = res;
                password1El.type = "text";

                password2El.value = res;
                password2El.type = "text";

                M.updateTextFields();
            });

            var saveDeleteClicked = function(e) {

                var xhr = new XMLHttpRequest();
                xhr.open("POST", window.warpGlobals.URLs['usersEdit']);
                xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
                xhr.addEventListener("load", function(e) {
                    var resp = JSON.parse(this.responseText);
                    if (this.status == 200) {
                        table.replaceData();
                        M.toast({html: 'Action successfull.'});
                        editModal.close();
                    }
                    else {
                        if (editModal.isOpen) {
                            errorMsg.innerText = resp.msg;
                            errorDiv.style.display = "block";
                        }
                        else {
                            WarpModal.getInstance().open("Error",resp.msg);
                        }
                    }
                });

                if (e.target == saveBtn) {

                    let err = "";
                    if (password1El.value !== password2El.value) {
                        err = "Passwords doesn't match";
                    }

                    if (loginEl.disabled) {
                        if (nameEl.value === "")
                            err = "Name cannot be empty.";
                    }
                    else if (loginEl.value === "" || nameEl.value === "" || password1El.value === "") {
                        err = "All fields are mandatory";
                    }

                    if (err) {
                        errorMsg.innerText = err;
                        errorDiv.style.display = "block";
                        return;
                    }

                    errorDiv.style.display = "none";

                    let accountTypeSelect = M.FormSelect.getInstance(accountTypeSelectEl);
                    let action = loginEl.disabled? "update": "add";

                    let actionData = {
                        login: loginEl.value,
                        name: nameEl.value,
                        account_type: parseInt(accountTypeSelect.getSelectedValues()[0]),
                        action: action
                    };

                    if (password1El.value !== "")
                        actionData['password'] = password1El.value;

                    xhr.send( JSON.stringify(actionData));
                }
                else if (e.target == deleteBtn) {

                    let modalBtnClicked = function(buttonId) {

                        if (buttonId != 1)
                            return;

                        let actionData = {
                            login: loginEl.value,
                            action: "delete"
                        };

                        xhr.send( JSON.stringify(actionData));
                    }

                    var modalOptions = {
                        buttons: [ {id: 1, text: "YES"}, {id: 0, text: "NO"} ],
                        onButtonHook: modalBtnClicked
                    }

                    var msg = "This will fail if user had any bookings in the past, so it is usually a better idea to BLOCK user.";
                    WarpModal.getInstance().open("Are you sure to delete user: "+loginEl.value,msg,modalOptions);
                }
            };

            saveBtn.addEventListener('click', saveDeleteClicked);
            deleteBtn.addEventListener('click', saveDeleteClicked);

        }

        login = login || "";
        if (typeof(account_type) === 'undefined')
        account_type = defaultAccountType;
        name = name || "";

        loginEl.value = login;
        loginEl.disabled = login !== "";

        deleteBtn.style.display =
            login !== "" && login !== window.warpGlobals['login'] ? "inline-block": "none";

        nameEl.value = name;

        for (let r of accountTypes) {
            if (!('value' in r))
                continue;

            let optEl = document.createElement('option');
            optEl.value = r['value'];
            optEl.appendChild( document.createTextNode(r['label']));
            if (r['value'] == account_type)
                optEl.selected = "true";
                accountTypeSelectEl.appendChild(optEl);
        }

        M.FormSelect.init(accountTypeSelectEl);

        password1El.value = "";
        password1El.type = "password";
        password2El.value = "";
        password2El.type = "password";

        errorDiv.style.display = "none";
        errorMsg.innerText = "";

        M.updateTextFields();
        editModal.open();
    }

    var addUserBtn = document.getElementById('add_user_btn');
    addUserBtn.addEventListener('click', function(e) {
        showEditDialog();
    });

});

