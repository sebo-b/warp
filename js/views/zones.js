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

    var showEditDialog;
    var table;

    // Sentinel for the "(none)" header-filter option (ungrouped zones).
    // Single source of truth is warp.db UNGROUPED_FILTER_KEY, handed to the
    // frontend via the template global — never duplicated as a JS literal.
    var UNGROUPED_FILTER_KEY = window.warpGlobals.ungroupedFilterKey;

    // Custom header filter: a <select> of "---" (no filter), "(none)" (ungrouped)
    // and the named groups fetched from the server.
    var zoneGroupHeaderFilter = function(cell, onRendered, success, cancel, editorParams) {
        var select = document.createElement("select");
        select.className = "warp_select browser-default";

        var optEmpty = document.createElement("option");
        optEmpty.value = "";            // empty -> Tabulator drops the filter
        optEmpty.textContent = "---";
        select.appendChild(optEmpty);

        var optNone = document.createElement("option");
        optNone.value = UNGROUPED_FILTER_KEY;
        optNone.textContent = TR("zoneGroup.None");
        select.appendChild(optNone);

        var appendGroups = function(groups) {
            for (let g of groups) {
                var opt = document.createElement("option");
                opt.value = g;
                opt.textContent = g;
                select.appendChild(opt);
            }
        };

        Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
            .then(function(result) { appendGroups(result.response || []); });

        select.addEventListener("change", function() { success(select.value); });

        // Rebuild named options after a save/delete may have changed the groups.
        select._warpRebuild = function() {
            var prevValue = select.value;
            while (select.options.length > 2)
                select.remove(2);
            return Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
                .then(function(result) {
                    appendGroups(result.response || []);
                    var values = Array.from(select.options).map(o => o.value);
                    if (values.includes(prevValue)) {
                        select.value = prevValue;
                    } else {
                        select.value = "";
                        success("");
                    }
                });
        };

        return select;
    };

    function refreshGroupFilter() {
        var col = table.getColumn("zone_group");
        if (!col) return;
        var filterEl = col.getElement().querySelector(".warp_select");
        if (filterEl && filterEl._warpRebuild)
            filterEl._warpRebuild();
    }

    var addEditClicked = function(e, cell) {
        let args = [null, "", "10", null];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [data['id'], data['name'], data['zone_type'], data['zone_group'] || null];
        }

        showEditDialog.apply(null, args)
            .then(function(actionData) {
                if (actionData.action == 'save') {
                    delete actionData.action;
                    if (actionData.id === null)
                        delete actionData.id;
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesAddOrEdit'], actionData)
                        .then(function() { refreshGroupFilter(); });
                }
                else if (actionData.action == 'delete')
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {id: actionData.id})
                        .then(function() { refreshGroupFilter(); });
            })
            .then(() => table.replaceData());
    }

    var clickFuncFactory = function(targetURL) {
        return function(e, cell) {
            let zid = cell.getRow().getData()['id'];
            let url = window.warpGlobals.URLs[targetURL].replace('__ZID__', zid);
            window.location.href = url;
        }
    }

    var addZoneBtn = document.getElementById('add_zone_btn');
    addZoneBtn.addEventListener('click', addEditClicked);

    table = new Tabulator("#zonesTable", {
        height: "3000px",
        maxHeight: "100%",
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['zonesList'],
        index: "id",
        layout: "fitDataFill",
        columnDefaults: {resizable: true},
        pagination: true,
        paginationMode: "remote",
        sortMode: "remote",
        filterMode: "remote",
        ajaxConfig: "POST",
        ajaxContentType: "json",
        columns: [
            {formatter: iconFormater, formatterParams: {icon: "manage_accounts", colorClass: "green-text text-darken-4"}, width: 40, hozAlign: "center", cellClick: clickFuncFactory('zoneAssign'), headerSort: false, tooltip: TR('Manage users')},
            {formatter: iconFormater, formatterParams: {icon: "edit", colorClass: "green-text text-darken-4"}, width: 40, hozAlign: "center", cellClick: addEditClicked, headerSort: false, tooltip: TR('Edit zone')},
            {title: TR("Zone name"), field: "name", headerFilter: "input", headerFilterFunc: "starts"},
            {title: TR("Zone type"), field: "zone_type", formatter: zoneTypeFormatter,
                headerFilter: Utils.makeSelect(zoneTypeLabels), headerFilterFunc: "="},
            {title: TR("Zone group"), field: "zone_group", headerFilter: zoneGroupHeaderFilter, headerFilterFunc: "=",
                formatter: function(cell) { return cell.getValue() || '<span class="grey-text">—</span>'; }},
            {title: TR("Num of admins"), field: "admins"},
            {title: TR("Num of users"), field: "users"},
            {title: TR("Num of viewers"), field: "viewers"},
        ],
        initialSort: [
            {column: "name", dir: "asc"},
        ],
    });

    var editModalEl = document.getElementById('edit_modal');
    var zoneNameEl = document.getElementById("zone_name");
    var zoneTypeEl = document.getElementById("zone_type");
    var zoneGroupEl = document.getElementById("zone_group");
    var zoneGroupHelperEl = document.getElementById("zone_group_helper");
    var errorDiv = document.getElementById('error_div');
    var errorMsg = document.getElementById('error_message');
    var saveBtn = document.getElementById('edit_modal_save_btn');
    var deleteBtn = document.getElementById('edit_modal_delete_btn');

    // Show a hint when the typed group name is new (will be created on save).
    function updateGroupHelper() {
        var v = zoneGroupEl.value.trim();
        var known = zoneGroupEl._warpGroups || [];
        if (v !== "" && known.indexOf(v) === -1) {
            zoneGroupHelperEl.textContent = TR("zoneGroup.NewGroupWillBeCreated");
            zoneGroupHelperEl.style.display = "";
        } else {
            zoneGroupHelperEl.style.display = "none";
            zoneGroupHelperEl.textContent = "";
        }
    }
    zoneGroupEl.addEventListener('input', updateGroupHelper);

    // Materialize autocomplete fed by the existing group names.
    function setupGroupAutocomplete() {
        return Utils.xhr.get(window.warpGlobals.URLs['zonesGroups'], {toastOnSuccess: false})
            .then(function(result) {
                var groups = result.response || [];
                var acData = {};
                for (let g of groups)
                    if (g) acData[g] = null;
                var prev = M.Autocomplete.getInstance(zoneGroupEl);
                if (prev) prev.destroy();
                M.Autocomplete.init(zoneGroupEl, {
                    data: acData,
                    minLength: 0,
                    dropdownOptions: { constrainWidth: false, container: document.body },
                    onAutocomplete: updateGroupHelper
                });
                zoneGroupEl._warpGroups = groups;
                updateGroupHelper();
            });
    }

    showEditDialog = function(id, name, zoneType, zoneGroup) {

        var editModal = M.Modal.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = M.Modal.init(editModalEl);
        }

        var zoneName = name || "";
        zoneNameEl.value = zoneName;
        zoneTypeEl.value = zoneType != null ? String(zoneType) : "10";
        zoneGroupEl.value = zoneGroup || "";
        zoneGroupEl._warpGroups = [];
        zoneGroupHelperEl.style.display = "none";
        setupGroupAutocomplete();
        errorDiv.style.display = "none";
        errorMsg.innerText = "";
        deleteBtn.style.display = (id === null) ? "none" : "inline-block";

        M.updateTextFields();
        editModal.open();

        return new Promise((resolve, reject) => {

            let resolved = false;

            function onClick(e) {
                switch (e.target) {
                    case saveBtn: {
                        if (zoneNameEl.value === "") {
                            errorMsg.innerText = TR('Zone name cannot be empty.');
                            errorDiv.style.display = "block";
                            return;
                        }
                        resolved = true;
                        editModal.close();
                        resolve({action: 'save', id: id, name: zoneNameEl.value,
                                 zone_type: parseInt(zoneTypeEl.value),
                                 zone_group: zoneGroupEl.value || null});
                        break;
                    }
                    case deleteBtn:
                        WarpModal.getInstance().open(
                            TR("Are you sure to delete zone: %{zone_name}", {zone_name: zoneName}),
                            TR("You will delete the log of all past bookings in this zone. It is usually a better idea to unassign all users from the zone to make it inaccessible."),
                            {
                                buttons: [{id: 1, text: TR("btn.Yes")}, {id: 0, text: TR("btn.No")}],
                                onButtonHook: (btnId) => {
                                    if (btnId == 1) {
                                        resolved = true;
                                        editModal.close();
                                        resolve({action: 'delete', id: id});
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
            };
        });
    }

});
