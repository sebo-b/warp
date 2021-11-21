"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    var iconFormater = function(cell, formatterParams, onRendered) {
        var icon = formatterParams.icon || "warning";
        var colorClass = formatterParams.colorClass || "";
        return '<i class="material-icons-outlined '+colorClass+'">'+icon+'</i>';
    }

    var showEditDialog;

    var editClicked = function(e,cell) {
        let data = cell.getRow().getData();
        showEditDialog(data.login, data.name);
    }

    var addUserBtn = document.getElementById('add_user_btn');
    addUserBtn.addEventListener('click', function(e) {
        showEditDialog();
    });

    var assignClicked = function(e,cell) {
        let login = cell.getRow().getData()['login'];
        let url = window.warpGlobals.URLs['groupAssign'].replace('__LOGIN__',login);
        window.location.href = url;
    }

    var table = new Tabulator("#groupsTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['usersList'],
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
            {formatter:iconFormater, formatterParams:{icon:"manage_accounts",colorClass:"green-text text-darken-4"}, width:40, hozAlign:"center", cellClick:assignClicked, headerSort:false},
            {formatter:iconFormater, formatterParams:{icon:"edit",colorClass:"green-text text-darken-4"}, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
            {title:TR("Group id"), field: "login", headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("Group name"), field: "name", headerFilter:"input", headerFilterFunc:"starts"},
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"name", dir:"asc"}
        ],
        initialFilter: [
            {field:"account_type", type:">=", value:100}     // show groups only
        ]
    });

    showEditDialog = function(login,name) {

        var editModalEl = document.getElementById('edit_modal');
        var editModal = M.Modal.getInstance(editModalEl);

        var loginEl = document.getElementById("login");
        var nameEl = document.getElementById("name");

        var saveBtn = document.getElementById('edit_modal_save_btn');
        var deleteBtn = document.getElementById('edit_modal_delete_btn');

        var errorDiv = document.getElementById("error_div");
        var errorMsg = document.getElementById("error_message");

        if (typeof(editModal) === 'undefined') {

            editModal = M.Modal.init(editModalEl);

            var saveBtnClicked = function(e) {

                let err = "";

                if (nameEl.value === "")
                    err = TR("Group name cannot be empty.");

                if (err) {
                    errorMsg.innerText = err;
                    errorDiv.style.display = "block";
                    return;
                }

                errorDiv.style.display = "none";

                let action = loginEl.disabled? "update": "add";

                let actionData = {
                    login: loginEl.value,
                    name: nameEl.value,
                    account_type: 100,  // group
                    action: action
                };

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

                    if (buttonId != 1)
                        return;

                    Utils.xhr.post(
                        window.warpGlobals.URLs['usersDelete'],
                        { login: loginEl.value })
                    .then( () => {
                        table.replaceData();
                        editModal.close();
                    });
                }

                var modalOptions = {
                    buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                    onButtonHook: modalBtnClicked
                }

                var msg = "";
                WarpModal.getInstance().open(TR("Are you sure to delete group: %{group}", {group:loginEl.value}),msg,modalOptions);

            };

            saveBtn.addEventListener('click', saveBtnClicked);
            deleteBtn.addEventListener('click', deleteBtnClicked);
        }

        login = login || "";
        name = name || "";

        loginEl.value = login;
        loginEl.disabled = login !== "";

        deleteBtn.style.display =
            login !== "" ? "inline-block": "none";

        nameEl.value = name;

        errorDiv.style.display = "none";
        errorMsg.innerText = "";

        M.updateTextFields();
        editModal.open();
    }

});

