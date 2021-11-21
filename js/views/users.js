"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    let accountTypes = [
        {label: "---" },
        {label: TR("accountTypes.Admin"), value: 10 },
        {label: TR("accountTypes.User"), value: 20 },
        {label: TR("accountTypes.BLOCKED"), value: 90 }
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
        return '<i class="material-icons-outlined green-text text-darken-3">edit</i>';
    }

    var editClicked = function(e,cell) {
        let data = cell.getRow().getData();
        showEditDialog(data.login, data.account_type, data.name);
    }

    var table = new Tabulator("#usersTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['usersList'],
        langs: warpGlobals.i18n.tabulatorLangs,
        index:"login",
        layout:"fitDataFill",
        columnDefaults:{
            resizable:true,
        },
        pagination:true,
        paginationMode:"remote",
        sortMode:"remote",
        filterMode:"remote",
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: [
            {formatter:editFormater, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
            {title:TR("Login"), field: "login", headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("User name"), field: "name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("Account type"), field: "account_type", headerFilter:"select", headerFilterFunc:"=", headerFilterParams:{ values: accountTypes }, formatter:accountTypeFormatter  }
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"name", dir:"asc"}
        ],
        initialFilter: [
            {field:"account_type", type:"<", value:100}     // don't show groups
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

        let addToGroupEl = document.getElementById('add_to_group');

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

            var saveBtnClicked = function(e) {

                let err = "";
                if (password1El.value !== password2El.value) {
                    err = TR("Passwords don't match");
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
                    action: action,
                    groups: []
                };

                if (password1El.value !== "")
                    actionData['password'] = password1El.value;

                let addToGroup = M.Chips.getInstance(addToGroupEl);
                for (let g of addToGroup.getData())
                    actionData.groups.push( Utils.makeUserStrRev(g.tag)[0] );

                Utils.xhr.post(
                    window.warpGlobals.URLs['usersEdit'],
                    actionData,
                    {errorOnFailure: false})
                .then( () => {
                    table.replaceData();
                    editModal.close();
                }).catch( (value) => {
                    errorMsg.innerText = value.errorMsg;
                    errorDiv.style.display = "block";
                });
            }

            var deleteBtnClicked = function(e) {

                let modalBtnClicked = function(buttonId) {

                    if (buttonId != 1 && buttonId != 3)
                        return;

                    let actionData = { login: loginEl.value };

                    if (buttonId == 3)
                        actionData['force'] = true;

                    Utils.xhr.post(
                        window.warpGlobals.URLs['usersDelete'],
                        actionData,
                        {errorOnFailure: false})
                    .then( () => {
                        table.replaceData();
                        editModal.close();
                    }).catch( (value) => {
                        if (value.status == 406) { // past bookings
                            var modalOptions = {
                                buttons: [ {id: 3, text: TR("btn.YES, I'M SURE")}, {id: 2, text: TR("btn.No")} ],
                                onButtonHook: modalBtnClicked
                            }

                            let bookCount = value.response['bookCount'] || 0;
                            let msg = TR("User has XXX bookin(s) ... ",{smart_count:bookCount});
                            WarpModal.getInstance().open(
                                TR("ARE YOU SURE TO DELETE USER: %{user}?",{user:loginEl.value}),
                                msg,modalOptions);
                        }
                        else {
                            WarpModal.getInstance().open(TR("Error"),value.errorMsg);
                        }
                    });
                }

                var modalOptions = {
                    buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                    onButtonHook: modalBtnClicked
                }

                var msg = TR("You will delete the log of user's past bookings. It is usually a better idea to BLOCK the user.");
                WarpModal.getInstance().open(TR("Are you sure to delete user: %{user}",{user:loginEl.value}),msg,modalOptions);

            };

            saveBtn.addEventListener('click', saveBtnClicked);
            deleteBtn.addEventListener('click', deleteBtnClicked);

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

        let addToGroup = M.Chips.getInstance(addToGroupEl);
        let autocompletePromise, chipsDataPromise = null;
        if (addToGroup) {
            autocompletePromise = addToGroup.options.autocompleteOptions.data;
            addToGroup.destroy(); // we have to recreate chips instance to clean up all chips inside
        }
        else {
            autocompletePromise = Utils.xhr.post(
                window.warpGlobals.URLs['usersList'],
                {filters: [{field:"account_type", type:">=", value:100}]},
                {toastOnSuccess:false, errorOnFailure: false});
        }

        if (login) {
            chipsDataPromise = Utils.xhr.get(
                window.warpGlobals.URLs['userGroups'].replace('__LOGIN__',login),
                {toastOnSuccess:false, errorOnFailure: false});
        }

        let chipsOptions = {
            autocompleteOptions: {
                minLength: 2,
                dropdownOptions: {
                    container: document.body,
                    constrainWidth: false
                }
            },
            placeholder: TR("Add to group"),
            limit: Infinity,
            onChipAdd: function(chip) {

                let i = this.chipsData.length - 1;  // chips are always pushed
                let t = this.chipsData[i].tag;

                if (!(t in this.autocomplete.options.data)) {
                    this.deleteChip(i);
                }
            }
        };

        Promise.all([autocompletePromise,chipsDataPromise])
        .then( (v) => {

            if ('response' in v[0]) {
                chipsOptions.autocompleteOptions.data = {};
                for (let row of v[0].response.data)
                    chipsOptions.autocompleteOptions.data[
                        Utils.makeUserStr(row['login'],row['name']) ] = null;
            }
            else {
                chipsOptions.autocompleteOptions.data = v[0];
            }

            if (v[1] !== null) {
                chipsOptions.data = [];
                for (let row of v[1].response)
                    chipsOptions.data.push( {tag: Utils.makeUserStr(row['login'],row['name']) });
            }

            addToGroup = M.Chips.init(addToGroupEl, chipsOptions);
            editModal.open();
        })
        .catch( (v) => {
            WarpModal.getInstance().open(TR("Error"),v.errorMsg);
        });

    }

    var addUserBtn = document.getElementById('add_user_btn');
    addUserBtn.addEventListener('click', function(e) {
        showEditDialog();
    });

});

