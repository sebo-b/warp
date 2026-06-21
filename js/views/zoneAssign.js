"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    var table;

    let zoneRoles = [
        {label: "---" },
        {label: TR("zoneRoles.ZoneAdmin"), value: 10 },
        {label: TR("zoneRoles.User"), value: 20 },
        {label: TR("zoneRoles.Viewer"), value: 30 }
    ];
    let defaultZoneRole = 20;

    var zoneRoleFormatter = function(cell, formatterParams) {
        let value = cell.getValue();
        for (let i of zoneRoles) {
            if (i['value'] == value)
                return i['label'];
        }
        return zoneRoles[0]['label'];
    }

    var iconFormater = function(cell, formatterParams, onRendered) {
        var icon = formatterParams.icon || "warning";
        var colorClass = formatterParams.colorClass || "";
        return '<i class="material-icons '+colorClass+'">'+icon+'</i>';
    }

    var userGroupFormatter = function(cell, formatterParams, onRendered) {
        let data = cell.getData();
        let isGroup = data['isGroup'];
        if (!isGroup)
            return cell.getValue();

        let url = window.warpGlobals.URLs['groupAssign'].replace('__LOGIN__',data['login']);
        return '<a href="'+url+'" class="userGroupCell">'+cell.getValue()+"</a>";
    }

    var userTypeFormater = function(cell, formatterParams, onRendered) {
        let isGroup = cell.getRow().getData()['isGroup'];

        if (isGroup)
            return '<i class="material-icons">group</i>';
        else
            return '<i class="material-icons">person</i>';
    }

    var deleteClicked = function(e,cell) {

        let cellData = cell.getRow().getData();

        WarpModal.getInstance().open(
            TR("Are you sure?"),
            TR("Are you sure to unassign %{user} from the zone?",{user:cellData['name']}),
            {
                buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                onButtonHook: function(buttonId) {
                    if (buttonId != 1)
                        return;

                    let payload = {
                        zid: window.warpGlobals.zid,
                        remove: [ cellData['login'] ] };
                    Utils.xhr.post(window.warpGlobals.URLs['zoneAssign'],payload)
                        .then( () => {table.replaceData();})
                }
            }
        );
    }

    var zoneRoleChanged = function(cell) {
        let payload = {
            zid: window.warpGlobals.zid,
            change: [{
                login: cell.getData()['login'],
                role: cell.getValue()
            }]
        };
        Utils.xhr.post(window.warpGlobals.URLs['zoneAssign'], payload);
    }

    table = new Tabulator("#zone_assignees_table", {
        height: "2000px",   //this will be limited by maxHeight, we need to provide height
        maxHeight:"100%",   //to make paginationSize work correctly
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['zoneMembers'],
        ajaxParams:{zid:window.warpGlobals.zid},
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
            {formatter:iconFormater, formatterParams:{icon:"person_remove",colorClass:"warp-icon-danger"}, width:40, hozAlign:"center", cellClick:deleteClicked, headerSort:false},
            {title:TR("Login"), field: "login", formatter:userGroupFormatter, headerFilter:"input", headerFilterFunc:"starts"},
            {title:TR("User/group name"), field: "name", formatter:userGroupFormatter, headerFilter:"input", headerFilterFunc:"starts"},
            {
                title:TR("Zone role"),
                field: "zone_role",
                headerFilter:Utils.makeSelect(zoneRoles), headerFilterFunc:"=",
                editor:Utils.makeSelect(zoneRoles),
                formatter:zoneRoleFormatter
            },
            {formatter:userTypeFormater, width:40, hozAlign:"center", headerSort:false},
        ],
        initialSort: [
            {column:"login", dir:"asc"},
            {column:"name", dir:"asc"},
            {column:"zone_role", dir:"asc"}
        ]
    });

    table.on('cellEdited', zoneRoleChanged);

    var assignToZoneBtn = document.getElementById('assign_to_zone_btn');
    var assignToZoneModalEl = document.getElementById('assign_to_zone_modal');
    var assignToZoneModaAutocompleteEl = document.getElementById('assign_to_zone_autocomplete');

    let assignToZoneTable;

    assignToZoneBtn.addEventListener('click', function(e) {

        let assignToZoneModal = M.Modal.getInstance(assignToZoneModalEl);

        let showModal = function() {
            assignToZoneTable.clearData();
            assignToZoneModal.open();
        }

        let initModal = function(usersData) {

            assignToZoneModal = M.Modal.init(assignToZoneModalEl);

            let assignToZoneTableRemoveClicked = function(e,cell) {
                cell.getRow().delete();
            }

            document.getElementById('assign_to_zone_modal_addbtn').addEventListener('click', function(e) {

                    let payload = {
                        zid: window.warpGlobals.zid,
                        change: assignToZoneTable.getData().map(
                            (a) => ({'login': a['login'], 'role': a['zone_role']}) )
                    }

                    Utils.xhr.post(window.warpGlobals.URLs['zoneAssign'],payload)
                         .then( () => {table.replaceData();})
            });

            assignToZoneTable = new Tabulator("#assign_to_zone_table", {
                height: "200px",
                maxHeight:"100%",
                index:"login",
                layout:"fitDataFill",
                headerVisible: false,
                columns: [
                    {formatter:iconFormater, formatterParams:{icon:"disabled_by_default",colorClass:"warp-icon-danger"}, width:40, hozAlign:"center", cellClick:assignToZoneTableRemoveClicked},
                    {field: "name"},
                    {field: "zone_role", editor:Utils.makeSelect(zoneRoles), formatter:zoneRoleFormatter},
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
                assignToZoneTable.updateOrAddData([{"login": u[0],"name": u[1], "zone_role": defaultZoneRole}]);
                assignToZoneModaAutocompleteEl.value = "";
                assignToZoneModaAutocompleteEl.focus();
            }

            M.Autocomplete.init(assignToZoneModaAutocompleteEl,{
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

        if (typeof(assignToZoneModal) == 'undefined') {

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

