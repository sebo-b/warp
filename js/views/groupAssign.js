"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    var table;

    var iconFormater = function(cell, formatterParams, onRendered) {
        var icon = formatterParams.icon || "warning";
        var colorClass = formatterParams.colorClass || "";
        return '<i class="material-icons '+colorClass+'">'+icon+'</i>';
    }

    var userTypeFormater = function(cell, formatterParams, onRendered) {
        let isGroup = cell.getRow().getData()['isGroup'];

        if (isGroup)
            return '<i class="material-icons">group</i>';
        else
            return '<i class="material-icons">person</i>';
    }

    var userGroupFormatter = function(cell, formatterParams, onRendered) {
        let data = cell.getData();
        let isGroup = data['isGroup'];
        if (!isGroup)
            return cell.getValue();

        let url = window.warpGlobals.URLs['groupAssignView'].replace('__LOGIN__',data['login']);
        return '<a href="'+url+'" class="userGroupCell">'+cell.getValue()+"</a>";
    }

    var deleteClicked = function(e,cell) {

        let cellData = cell.getRow().getData()

        let modalBtnClicked = function(buttonId) {

            if (buttonId != 1)
                return;

            Utils.xhr.post(
                window.warpGlobals.URLs['groupsAssignXHR'],
                {
                    groupLogin: window.warpGlobals.groupLogin,
                    remove: [ cellData['login'] ]
                }).then(() => {table.replaceData()})
        };

        var modalOptions = {
            buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
            onButtonHook: modalBtnClicked
        }

        var msg = TR("Are you sure to remove %{user} from group %{group}?",{user:cellData['name'], group:window.warpGlobals.groupName});
        WarpModal.getInstance().open(TR("Are you sure?"),msg,modalOptions);
    }

    var table = new Tabulator("#groupMembersTable", {
        height: "2000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['groupMemberList'],
        ajaxParams:{groupLogin:window.warpGlobals.groupLogin},
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
            {formatter:iconFormater, formatterParams:{icon:"person_remove",colorClass:"red-text text-darken-3"}, width:40, hozAlign:"center", cellClick:deleteClicked, headerSort:false},
            {title:TR("Login"), field: "login", formatter:userGroupFormatter, headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("User/group name"), field: "name", formatter:userGroupFormatter, headerFilter:"input", headerFilterFunc:"starts"},
            {formatter:userTypeFormater, width:40, hozAlign:"center", headerSort:false},
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"name", dir:"asc"}
        ]
    });

    var addToGroupBtn = document.getElementById('add_to_group_btn');
    var addToGroupModalEl = document.getElementById('add_to_group_modal');
    var addToGroupModalHeader = document.getElementById('add_to_group_modal_header');
    var addToGroupModaAutocompleteEl = document.getElementById('add_to_group_autocomplete');

    let addToGroupTable;

    addToGroupBtn.addEventListener('click', function(e) {

        let addToGroupModal = M.Modal.getInstance(addToGroupModalEl);

        let showModal = function() {
            addToGroupModalHeader.innerHTML = TR("Add to group %{group}",{group: window.warpGlobals.groupName});
            addToGroupTable.clearData();
            addToGroupModal.open();
        }

        let initModal = function(usersData) {

            addToGroupModal = M.Modal.init(addToGroupModalEl);

            let addToGroupTableRemoveClicked = function(e,cell) {
                cell.getRow().delete();
            }

            var addToGroupModalAddBtn = document.getElementById('add_to_group_modal_addbtn');
            addToGroupModalAddBtn.addEventListener('click', function(e) {

                let addData = addToGroupTable.getData().map(a => a['login']);
                if (addData.length == 0)
                    return;

                Utils.xhr.post(
                    window.warpGlobals.URLs['groupsAssignXHR'],
                    {
                        groupLogin: window.warpGlobals.groupLogin,
                        add: addData
                    }).then(() => {table.replaceData()})
            });

            addToGroupTable = new Tabulator("#addToGroupTable", {
                height: "200px",
                maxHeight:"100%",
                index:"login",
                layout:"fitDataFill",
                headerVisible: false,
                columns: [
                    {formatter:iconFormater, formatterParams:{icon:"disabled_by_default",colorClass:"red-text text-darken-3"}, width:40, hozAlign:"center", cellClick:addToGroupTableRemoveClicked},
                    {field: "name"},
                ],
                initialSort: [
                    {column:"name", dir:"asc"}
                ]
            });

            let autocompleteData = {}
            for (let i of usersData) {
                autocompleteData[ Utils.makeUserStr(i['login'],i['name']) ] = null;
            }

            let onAutocomplete = function(selectedText) {
                var u = Utils.makeUserStrRev(selectedText);
                addToGroupTable.updateOrAddData([{"login": u[0],"name": u[1]}]);
                addToGroupModaAutocompleteEl.value = "";
                addToGroupModaAutocompleteEl.focus();
            }

            M.Autocomplete.init(addToGroupModaAutocompleteEl,{
                data: autocompleteData,
                dropdownOptions: {
                    constrainWidth: false,
                    container: document.body
                },
                minLength: 2,
                limit: 10,
                onAutocomplete: onAutocomplete
            });
        }

        if (typeof(addToGroupModal) == 'undefined') {

            Utils.xhr.post(
                window.warpGlobals.URLs['usersList'],
                {},
                {toastOnSuccess: false})
            .then( function(value) {
                initModal(value.response['data']);
                showModal();
            });

        }
        else {
            showModal();
        }
    });



});

