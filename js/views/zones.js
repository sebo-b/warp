"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    var iconFormater = function(cell, formatterParams, onRendered) {
        var icon = formatterParams.icon || "warning";
        var colorClass = formatterParams.colorClass || "";
        var iconClass = formatterParams.iconClass || "material-icons-outlined";
        return '<i class="'+iconClass+' '+colorClass+'">'+icon+'</i>';
    }

    var showEditDialog;
    var table;

    var addEditClicked = function(e,cell) {
        let args = [null,"",""];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [ data['id'],data['name'],data['zone_group'] ];
        }

        showEditDialog.apply(null,args)
            .then(function(actionData) {
                if (actionData.action == 'save') {
                    delete actionData.action;
                    if (actionData.id === null)
                        delete actionData.id;
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesAddOrEdit'],actionData);
                }
                else if (actionData.action == 'delete')
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {id:actionData.id} );
            })
            .then(() => table.replaceData() );
    }

    var clickFuncFactory = function(targetURL) {
        return function(e,cell) {
            let zid = cell.getRow().getData()['id'];
            let url = window.warpGlobals.URLs[targetURL].replace('__ZID__',zid);
            window.location.href = url;
        }
    }

    var addZoneBtn = document.getElementById('add_zone_btn');
    addZoneBtn.addEventListener('click', addEditClicked);

    table = new Tabulator("#zonesTable", {
        height: "3000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['zonesList'],
        index:"id",
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
            {formatter:iconFormater, formatterParams:{icon:"manage_accounts",colorClass:"green-text text-darken-4"}, width:40, hozAlign:"center", cellClick:clickFuncFactory('zoneAssign'), headerSort:false, tooltip: TR('Manage users')},
            {formatter:iconFormater, formatterParams:{icon:"edit",colorClass:"green-text text-darken-4"}, width:40, hozAlign:"center", cellClick:addEditClicked, headerSort:false, tooltip: TR('Edit zone')},
            {formatter:iconFormater, formatterParams:{icon:"map",colorClass:"green-text text-darken-4",iconClass:"material-icons"}, width:40, hozAlign:"center", cellClick:clickFuncFactory('zoneModify'), headerSort:false, tooltip: TR('Edit map')},
            {title:TR("Zone name"), field: "name", headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("Zone group"), field: "zone_group", headerFilter:"number", headerFilterFunc:"="},
            {title:TR("Num of admins"), field: "admins" },
            {title:TR("Num of users"), field: "users" },
            {title:TR("Num of viewers"), field: "viewers" },
        ],
        initialSort: [
            {column:"zone_group", dir:"asc"},
            {column:"name", dir:"asc"}
        ],
    });

    var editModalEl = document.getElementById('edit_modal');
    var zoneNameEl = document.getElementById("zone_name");
    var zoneGroupEl = document.getElementById("zone_group");
    var errorDiv = document.getElementById('error_div');
    var errorMsg = document.getElementById('error_message');
    var saveBtn = document.getElementById('edit_modal_save_btn');
    var deleteBtn = document.getElementById('edit_modal_delete_btn');

    showEditDialog = function(id,name,zoneGroup) {

        var editModal = M.Modal.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = M.Modal.init(editModalEl);
        }

        var zoneName = name || "";
        zoneNameEl.value = zoneName;
        zoneGroupEl.value = zoneGroup || "";
        errorDiv.style.display = "none";
        errorMsg.innerText = "";

        M.updateTextFields();

        deleteBtn.style.display = (id === null ) ? "none": "inline-block";

        editModal.open();

        return new Promise((resolve, reject) => {

            let resolved = false;

            function onClick(e) {

                switch (e.target) {
                    case saveBtn:

                        if (zoneNameEl.value == "" || zoneGroupEl.value == "") {
                            errorMsg.innerText = TR('Zone name and zone group cannot be empty.');
                            errorDiv.style.display = "block";
                            return;
                        }

                        resolved = true;
                        editModal.close();
                        resolve({action:'save', id: id, name: zoneNameEl.value, zone_group: parseInt(zoneGroupEl.value) });
                        break;
                    case deleteBtn:

                        WarpModal.getInstance().open(
                            TR("Are you sure to delete zone: %{zone_name}",{zone_name:zoneName}),
                            TR("You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible."),
                            {
                                buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                                onButtonHook: (btnId) => {
                                    if (btnId  == 1) {
                                        resolved = true;
                                        editModal.close();
                                        resolve({action:'delete', id: id});
                                    }
                                }
                            }
                        );
                        break;
                }
            }

            saveBtn.addEventListener('click', onClick);
            deleteBtn.addEventListener('click', onClick);

            editModal.options.onCloseStart = function() {
                saveBtn.removeEventListener('click', onClick);
                deleteBtn.removeEventListener('click', onClick);
                if (!resolved)
                    reject();
            }
        });

    }


});

