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

    var zoneTypeLabels = [
        { label: "---" },
        { value: 10, label: TR("zoneType.Disabled") },
        { value: 20, label: TR("zoneType.Enabled") },
        { value: 30, label: TR("zoneType.PublicView") },
        { value: 40, label: TR("zoneType.PublicBook") },
    ];

    var zoneTypeFormatter = function(cell) {
        var v = cell.getValue();
        for (var t of zoneTypeLabels)
            if (t.value == v) return t.label;
        return "";
    };

    var zoneGroupDisplay = function(groupValue) {
        if (groupValue === window.warpGlobals.DEFAULT_ZONEGROUP_KEY)
            return TR("zoneGroup.Default");
        return groupValue;
    };

    var zoneGroupFormatter = function(cell) {
        return zoneGroupDisplay(cell.getValue());
    };

    // Dynamic select header filter for zone_group: fetches groups from server,
    // builds a <select> with Default + named groups, uses "=" comparison
    // (matches the COALESCE'd '__DEFAULT__' in the backend list query).
    var zoneGroupHeaderFilter = function(cell, onRendered, success, cancel, editorParams) {
        var select = document.createElement("select");
        select.className = "warp_select";

        // Placeholder / clear option — empty value lets Tabulator's default emptyCheck drop the filter
        var optEmpty = document.createElement("option");
        optEmpty.value = "";
        optEmpty.textContent = "---";
        select.appendChild(optEmpty);

        // Default group sentinel — defined in db.py, exposed via template.
        // Backend intercepts this filter value and translates it to IS NULL.
        var optDefault = document.createElement("option");
        optDefault.value = window.warpGlobals.DEFAULT_ZONEGROUP_KEY;
        optDefault.textContent = TR("zoneGroup.Default");
        select.appendChild(optDefault);

        // Fetch and populate named groups
        Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
        .then(function(result) {
            for (let g of result.response) {
                var opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                select.appendChild(opt);
            }
        });

        select.addEventListener("change", function() {
            success(select.value);
        });

        // Expose a rebuild function so the filter dropdown can be refreshed
        // after a save (new group may have been created).
        select._warpRebuild = function(currentFilterValue) {
            // Remember current selection (internal sentinel or named group)
            var prevValue = select.value;

            // Remove all named group options, keep "---" and "Default"
            while (select.options.length > 2)
                select.remove(2);

            return Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
            .then(function(result) {
                for (let g of result.response) {
                    var opt = document.createElement("option");
                    opt.value = g;
                    opt.textContent = g;
                    select.appendChild(opt);
                }

                // Restore previous selection if it still exists, else reset to "---"
                var optionValues = Array.from(select.options).map(o => o.value);
                if (optionValues.includes(prevValue)) {
                    select.value = prevValue;
                } else {
                    select.value = "";
                    success("");
                }
            });
        };

        return select;
    };

    var showEditDialog;
    var table;

    var addEditClicked = function(e,cell) {
        let args = [null,"",window.warpGlobals.DEFAULT_ZONEGROUP_KEY,"10"];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [ data['id'],data['name'],data['zone_group'],data['zone_type'] ];
        }

        showEditDialog.apply(null,args)
            .then(function(actionData) {
                if (actionData.action == 'save') {
                    delete actionData.action;
                    if (actionData.id === null)
                        delete actionData.id;
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesAddOrEdit'],actionData)
                    .then(function() { refreshGroupFilter(); });
                }
                else if (actionData.action == 'delete')
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {id:actionData.id} )
                    .then(function() { refreshGroupFilter(); });
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

    // Refresh the zone_group header filter dropdown after save/delete.
    // Rebuilds the <option> list, preserving the current selection if still valid,
    // or resetting to "---" if the selected group was deleted.
    function refreshGroupFilter() {
        var col = table.getColumn("zone_group");
        if (!col) return;
        var filterEl = col.getElement().querySelector(".warp_select");
        if (filterEl && filterEl._warpRebuild)
            filterEl._warpRebuild();
    }

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
            {title:TR("Zone group"), field: "zone_group", formatter:zoneGroupFormatter,
                headerFilter:zoneGroupHeaderFilter, headerFilterFunc:"="},
            {title:TR("Zone type"), field: "zone_type", formatter: zoneTypeFormatter,
                headerFilter: Utils.makeSelect(zoneTypeLabels), headerFilterFunc:"="},
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
    var zoneGroupInputEl = document.getElementById("zone_group_input");
    var zoneGroupHelperEl = document.getElementById("zone_group_helper");
    var zoneTypeEl = document.getElementById("zone_type");
    var errorDiv = document.getElementById('error_div');
    var errorMsg = document.getElementById('error_message');
    var saveBtn = document.getElementById('edit_modal_save_btn');
    var deleteBtn = document.getElementById('edit_modal_delete_btn');

    showEditDialog = function(id,name,zoneGroup,zoneType) {

        var editModal = M.Modal.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = M.Modal.init(editModalEl);
        }

        var zoneName = name || "";
        zoneNameEl.value = zoneName;
        zoneTypeEl.value = zoneType != null ? String(zoneType) : "10";
        errorDiv.style.display = "none";
        errorMsg.innerText = "";

        deleteBtn.style.display = (id === null) ? "none" : "inline-block";

        return Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
        .then(function(result) {
            let groups = result.response;

            // Build autocomplete data: display-name → null (Materialize autocomplete format)
            // Always put Default group first, then named groups from the server
            let autocompleteData = {};
            autocompleteData[TR("zoneGroup.Default")] = null;
            for (let g of groups)
                if (g !== null && g !== undefined && g !== "")
                    autocompleteData[g] = null;

            // Destroy previous autocomplete instance if any
            let prevAC = M.Autocomplete.getInstance(zoneGroupInputEl);
            if (prevAC) prevAC.destroy();

            zoneGroupInputEl.value = zoneGroupDisplay(zoneGroup);

            M.Autocomplete.init(zoneGroupInputEl, {
                data: autocompleteData,
                minLength: 0,
                dropdownOptions: {
                    constrainWidth: false,
                    container: document.body
                },
                onAutocomplete: function() {
                    updateGroupHelper();
                }
            });

            // display-name → db-value map for saving
            // Default display name maps to null (DB value)
            let groupValueMap = {};
            groupValueMap[TR("zoneGroup.Default")] = null;
            for (let g of groups)
                if (g !== null && g !== undefined && g !== "")
                    groupValueMap[g] = g;

            function updateGroupHelper() {
                let inputVal = zoneGroupInputEl.value.trim();
                if (inputVal !== "" && !(inputVal in groupValueMap)) {
                    zoneGroupHelperEl.textContent = TR("zoneGroup.NewGroupWillBeCreated");
                    zoneGroupHelperEl.style.display = "";
                } else {
                    zoneGroupHelperEl.textContent = "";
                    zoneGroupHelperEl.style.display = "none";
                }
            }

            zoneGroupInputEl.addEventListener('input', updateGroupHelper);

            // Initial check in case pre-filled value is new
            updateGroupHelper();

            M.updateTextFields();
            editModal.open();

            return new Promise((resolve, reject) => {

                let resolved = false;

                function onClick(e) {

                    switch (e.target) {
                        case saveBtn: {

                            let inputVal = zoneGroupInputEl.value.trim();
                            // look up display name → db value; empty input → null (Default group)
                            let effectiveGroup = groupValueMap.hasOwnProperty(inputVal)
                                ? groupValueMap[inputVal]
                                : (inputVal || null);

                            if (zoneNameEl.value === "") {
                                errorMsg.innerText = TR('Zone name and zone group cannot be empty.');
                                errorDiv.style.display = "block";
                                return;
                            }

                            resolved = true;
                            editModal.close();
                            resolve({action:'save', id: id, name: zoneNameEl.value,
                                     zone_group: effectiveGroup, zone_type: parseInt(zoneTypeEl.value)});
                            break;
                        }
                        case deleteBtn:

                            WarpModal.getInstance().open(
                                TR("Are you sure to delete zone: %{zone_name}",{zone_name:zoneName}),
                                TR("You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible."),
                                {
                                    buttons: [ {id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")} ],
                                    onButtonHook: (btnId) => {
                                        if (btnId == 1) {
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
                    let ac = M.Autocomplete.getInstance(zoneGroupInputEl);
                    if (ac) ac.destroy();
                    saveBtn.removeEventListener('click', onClick);
                    deleteBtn.removeEventListener('click', onClick);
                    zoneGroupInputEl.removeEventListener('input', updateGroupHelper);
                    zoneGroupHelperEl.textContent = "";
                    zoneGroupHelperEl.style.display = "none";
                    if (!resolved)
                        reject();
                }
            });
        });

    }


});

