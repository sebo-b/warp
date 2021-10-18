"use strict";

if (typeof(Utils) === 'undefined')
    throw Error('bookas requires Utils module');


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

    var sendManageRequest = function(actionData) {

        actionData.groupLogin = window.warpGlobals.groupLogin;

        var xhr = new XMLHttpRequest();
        xhr.open("POST", window.warpGlobals.URLs['groupsManage'],true);
        xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
        xhr.addEventListener("load", function() {
            if (this.status == 200) {
                table.replaceData();
                M.toast({html: 'Action successfull.'});
            }
            else
                WarpModal.getInstance().open("Error","Something went wrong (status="+this.status+").");
            });

        xhr.send( JSON.stringify( actionData));
    }

    var deleteClicked = function(e,cell) {

        let cellData = cell.getRow().getData()

        let modalBtnClicked = function(buttonId) {

            if (buttonId != 1)
                return;

            sendManageRequest({ remove: [ cellData['login'] ] });
        };

        var modalOptions = {
            buttons: [ {id: 1, text: "YES"}, {id: 0, text: "NO"} ],
            onButtonHook: modalBtnClicked
        }

        var msg = "Are you sure to remove "+cellData['name']+" from group "+window.warpGlobals.groupName;+"?";
        WarpModal.getInstance().open("Are you sure?",msg,modalOptions);
    }

    var table = new Tabulator("#groupMembersTable", {
        height: "2000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        ajaxURL: window.warpGlobals.URLs['groupMemberList'],
        ajaxParams:{groupLogin:window.warpGlobals.groupLogin},
        index:"login",
        layout:"fitDataFill",
        resizableColumns:true,
        pagination: 'remote',
        ajaxSorting:true,
        ajaxFiltering:true,
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: [
            {formatter:iconFormater, formatterParams:{icon:"person_remove",colorClass:"red-text text-darken-3"}, width:40, hozAlign:"center", cellClick:deleteClicked, headerSort:false},
            {title:"Login", field: "login", headerFilter:"input", headerFilterFunc:"starts"},
            {title:"Name", field: "name", headerFilter:"input", headerFilterFunc:"starts"},
            {formatter:userTypeFormater, width:40, hozAlign:"center", headerSort:false},
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"Name", dir:"asc"}
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
            addToGroupModalHeader.innerHTML = "Add to group "+ window.warpGlobals.groupName;
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

                let data = addToGroupTable.getData().map(a => a['login']);
                if (data.length == 0)
                    return;

                sendManageRequest({ add: data });
            });

            addToGroupTable = new Tabulator("#addToGroupTable", {
                height: "200px",   //this will be limited by maxHeight, we need to provide height
                maxHeight:"100%",   //to make paginationSize work correctly
                index:"login",
                layout:"fitDataFill",
                headerVisible: false,
                columns: [
                    {formatter:iconFormater, formatterParams:{icon:"disabled_by_default",colorClass:"red-text text-darken-3"}, width:40, hozAlign:"center", cellClick:addToGroupTableRemoveClicked},
                    {title:"Name", field: "name", headerFilter:"input", headerFilterFunc:"starts"},
                ],
                initialSort: [
                    {column:"Name", dir:"asc"}
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

            var xhr = new XMLHttpRequest();
            xhr.open("POST", window.warpGlobals.URLs['usersList'],true);
            xhr.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
            xhr.addEventListener("load", function() {

                if (this.status == 200) {
                    let resp = JSON.parse(this.responseText);
                    initModal(resp['data']);
                    showModal();
                }
                else
                    WarpModal.getInstance().open("Error","Something went wrong (status="+this.status+").");
                });

            xhr.send("{}");

        }
        else {
            showModal();
        }
    });



});

