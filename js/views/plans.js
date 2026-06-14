"use strict";

import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';

import {TabulatorFull as Tabulator} from 'tabulator-tables';
import "./css/tabulator/tabulator_materialize.scss";

document.addEventListener("DOMContentLoaded", function(e) {

    var chipFormatter = function(cell) {
        let zones = cell.getValue();
        if (!zones || !zones.length) return '<span class="grey-text">—</span>';
        return zones.map(z => '<div class="chip" style="margin:1px 2px">' + z + '</div>').join('');
    };

    var iconFormater = function(cell, formatterParams, onRendered) {
        var icon = formatterParams.icon || "warning";
        var colorClass = formatterParams.colorClass || "";
        var iconClass = formatterParams.iconClass || "material-icons-outlined";
        return '<i class="'+iconClass+' '+colorClass+'">'+icon+'</i>';
    };

    var showEditDialog;
    var table;

    var openPlanModify = function(e, cell) {
        let pid = cell.getRow().getData()['id'];
        let url = window.warpGlobals.URLs['planModify'].replace('__PID__', pid);
        window.location.href = url;
    };

    var addEditClicked = function(e, cell) {
        let args = [null, "", null];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [data['id'], data['name'], data['default_zid']];
        }

        showEditDialog.apply(null, args)
            .then(function(actionData) {
                if (actionData.action === 'save') {
                    delete actionData.action;
                    if (actionData.id === null)
                        delete actionData.id;
                    return Utils.xhr.post(window.warpGlobals.URLs['plansAddOrEdit'], actionData);
                } else if (actionData.action === 'delete') {
                    return Utils.xhr.post(window.warpGlobals.URLs['plansDelete'], {id: actionData.id});
                }
            })
            .then(() => table.replaceData());
    };

    var addPlanBtn = document.getElementById('add_plan_btn');
    addPlanBtn.addEventListener('click', addEditClicked);

    table = new Tabulator("#plansTable", {
        height: "3000px",
        maxHeight: "100%",
        langs: warpGlobals.i18n.tabulatorLangs,
        ajaxURL: window.warpGlobals.URLs['plansList'],
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
            {formatter: iconFormater, formatterParams: {icon: "edit", colorClass: "green-text text-darken-4"}, width: 40, hozAlign: "center", cellClick: addEditClicked, headerSort: false, tooltip: TR('Edit plan')},
            {formatter: iconFormater, formatterParams: {icon: "map", colorClass: "green-text text-darken-4", iconClass: "material-icons"}, width: 40, hozAlign: "center", cellClick: openPlanModify, headerSort: false, tooltip: TR('Edit map & seats')},
            {title: TR("Plan name"), field: "name", headerFilter: "input", headerFilterFunc: "starts"},
            {title: TR("Default zone"), field: "default_zone_name"},
            {title: TR("Seats"), field: "seat_count"},
            {title: TR("Zones"), field: "zone_names", formatter: chipFormatter, headerSort: false},
        ],
        initialSort: [{column: "name", dir: "asc"}],
    });

    var editModalEl = document.getElementById('edit_modal');
    var planNameEl = document.getElementById("plan_name");
    var planDefaultZidEl = document.getElementById("plan_default_zid");
    var errorDiv = document.getElementById('error_div');
    var errorMsg = document.getElementById('error_message');
    var saveBtn = document.getElementById('edit_modal_save_btn');
    var deleteBtn = document.getElementById('edit_modal_delete_btn');

    showEditDialog = function(id, name, default_zid) {

        var editModal = M.Modal.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = M.Modal.init(editModalEl);
        }

        planNameEl.value = name || "";
        errorDiv.style.display = "none";
        errorMsg.innerText = "";
        deleteBtn.style.display = (id === null) ? "none" : "inline-block";

        return Utils.xhr.get(window.warpGlobals.URLs['plansAllZones'], {toastOnSuccess: false})
        .then(function(result) {
            let zones = result.response;

            // Rebuild zone dropdown
            planDefaultZidEl.innerHTML = '<option value="">-- No default zone --</option>';
            for (let z of zones) {
                var opt = document.createElement("option");
                opt.value = z.id;
                opt.textContent = z.name;
                planDefaultZidEl.appendChild(opt);
            }
            planDefaultZidEl.value = (default_zid !== null && default_zid !== undefined) ? String(default_zid) : "";

            M.updateTextFields();
            editModal.open();

            return new Promise((resolve, reject) => {
                let resolved = false;

                function onClick(e) {
                    switch (e.target) {
                        case saveBtn: {
                            if (!planNameEl.value.trim()) {
                                errorMsg.innerText = TR('Plan name cannot be empty.');
                                errorDiv.style.display = "block";
                                return;
                            }
                            let zid = planDefaultZidEl.value ? parseInt(planDefaultZidEl.value) : null;
                            resolved = true;
                            editModal.close();
                            resolve({action: 'save', id: id, name: planNameEl.value.trim(), default_zid: zid});
                            break;
                        }
                        case deleteBtn:
                            WarpModal.getInstance().open(
                                TR("Are you sure to delete plan: %{plan_name}", {plan_name: name}),
                                TR("You will delete all seats and the log of all past bookings on this plan."),
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
                    if (!resolved) reject();
                };
            });
        });
    };

});
