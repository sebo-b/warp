"use strict";

import html from './html/plans.html';
import Utils from './modules/utils.js';
import { M } from '../app/materialize.js';
import warpDialog from '../app/dialog.js';
import { createTable } from '../lib/tablePage.js';
import { initFormSelect } from '../lib/formSelect.js';
import { clearFieldError, showFieldError } from '../lib/formDialog.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import { lazyCache } from '../lib/lazyCache.js';
import { iconFormatter, chipListFormatter } from '../lib/formatters.js';
import * as bootstrap from '../app/bootstrap.js';
import * as nav from '../app/nav.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;

    var chipFormatter = chipListFormatter;
    var iconFormater = iconFormatter();

    // Custom header filter: a <select> of zone names fetched from the server.
    var zoneHeaderFilter = function(cell, onRendered, success, cancel, editorParams) {
        var select = document.createElement('select');
        select.className = 'warp_select browser-default';

        var optEmpty = document.createElement('option');
        optEmpty.value = '';
        optEmpty.textContent = '---';
        select.appendChild(optEmpty);

        var appendZones = function(names) {
            for (let n of names) {
                var opt = document.createElement('option');
                opt.value = n;
                opt.textContent = n;
                select.appendChild(opt);
            }
        };

        Utils.xhr.get(window.warpGlobals.URLs['zoneNames'], {toastOnSuccess: false})
            .then(function(result) { appendZones(result.response || []); });

        select.addEventListener('change', function() { success(select.value); });
        return select;
    };

    var showEditDialog;
    var table;

    var timezoneCache = lazyCache(function() {
        return Utils.xhr.get(window.warpGlobals.URLs['plansTimezones'], {toastOnSuccess: false})
            .then(function(result) { return result.response || []; });
    });

    var openPlanModify = function(e, cell) {
        let pid = cell.getRow().getData()['id'];
        let url = window.warpGlobals.URLs['planModify'].replace('__PID__', pid);
        ctx.navigate(url);
    };

    var addEditClicked = function(e, cell) {
        let args = [null, "", ""];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [data['id'], data['name'], data['timezone'] || ""];
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
            .then(function() {
                // A plan add/rename/delete changes the nav link set and the
                // prefs/calendar "Default plan" option list — refresh
                // /xhr/bootstrap and re-render the nav instead of leaving a
                // stale top nav for the rest of the session (PLAN_SPA_REFACTOR.md §1.2.1).
                bootstrap.refresh().then(function() { return nav.render(); });
                table.replaceData();
            })
            .catch(() => {});
    };

    root.querySelector('#add_plan_btn').addEventListener('click', addEditClicked, {signal: ctx.signal});

    table = createTable(root.querySelector('#plansTable'), {
        ajaxURL: window.warpGlobals.URLs['plansList'],
        index: "id",
        columns: [
            {formatter: iconFormater, formatterParams: {icon: "edit", colorClass: "warp-icon-edit"}, width: 40, hozAlign: "center", cellClick: addEditClicked, headerSort: false, tooltip: TR('Edit plan')},
            {formatter: iconFormater, formatterParams: {icon: "map", colorClass: "warp-icon-edit", iconClass: "material-icons"}, width: 40, hozAlign: "center", cellClick: openPlanModify, headerSort: false, tooltip: TR('Edit map & seats')},
            {title: TR("Plan name"), field: "name", headerFilter: "input", headerFilterFunc: "starts"},
            {title: TR("Timezone"), field: "timezone", headerFilter: "input", headerFilterFunc: "starts", tooltip: TR('Stored IANA timezone for this plan')},
            {title: TR("Seats"), field: "seat_count"},
            {title: TR("Zones"), field: "zone_names", formatter: chipFormatter, headerSort: false, headerFilter: zoneHeaderFilter, headerFilterFunc: "="},
        ],
        initialSort: [{column: "name", dir: "asc"}],
    });

    // Surface a backend-down/5xx on the initial table load as a full-page
    // error view (via the router's mount() rejection) instead of Tabulator's
    // inline alert — see tablePage.js `table.initialLoad`.
    await table.initialLoad;

    var editModalEl = root.querySelector('#edit_modal');
    var planNameEl = root.querySelector("#plan_name");
    var planTzEl = root.querySelector("#plan_timezone");
    var errorDiv = root.querySelector('#error_div');
    var errorMsg = root.querySelector('#error_message');
    var saveBtn = root.querySelector('#edit_modal_save_btn');
    var deleteBtn = root.querySelector('#edit_modal_delete_btn');

    // Per-open dialog state. The Save/Delete listeners are wired ONCE per mount
    // (not per open): wiring them per-open with {signal: ctx.signal} (unmount)
    // meant a second edit within one mount stacked a stale handler from the
    // first open, which ran first on Save, closed the modal, fired the second
    // open's onCloseStart while its `resolved` was still false -> reject(), and
    // the second handler's resolve() was a no-op on the settled promise -> the
    // POST was never sent and the edit was silently lost. Handlers read the
    // current open's args/state from this object instead of a per-open closure.
    var currentEdit = null;

    showEditDialog = function(id, name, timezone) {

        var editModal = warpDialog.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = warpDialog(editModalEl, {
                onCloseStart: function() {
                    // Runs for every close (Save, Delete, or dismiss). Only reject
                    // for a clean dismiss (no button resolved the promise yet).
                    if (currentEdit && !currentEdit.resolved) currentEdit.reject();
                }
            });

            function onClick(e) {
                if (!currentEdit) return;
                switch (e.target) {
                    case saveBtn: {
                        if (!planNameEl.value.trim()) {
                            showFieldError(errorDiv, errorMsg, TR('Plan name cannot be empty.'));
                            return;
                        }
                        if (!planTzEl.value) {
                            showFieldError(errorDiv, errorMsg, TR('Plan timezone must be selected.'));
                            return;
                        }
                        currentEdit.resolved = true;
                        editModal.close();
                        currentEdit.resolve({action: 'save', id: currentEdit.id, name: planNameEl.value.trim(), timezone: planTzEl.value});
                        break;
                    }
                    case deleteBtn:
                        confirmDelete(
                            TR("Are you sure to delete plan: %{plan_name}", {plan_name: currentEdit.name}),
                            TR("You will delete all seats and the log of all past bookings on this plan.")
                        ).then((confirmed) => {
                            if (confirmed && currentEdit) {
                                currentEdit.resolved = true;
                                editModal.close();
                                currentEdit.resolve({action: 'delete', id: currentEdit.id});
                            }
                        });
                        break;
                }
            }

            saveBtn.addEventListener('click', onClick, {signal: ctx.signal});
            deleteBtn.addEventListener('click', onClick, {signal: ctx.signal});
        }

        planNameEl.value = name || "";
        clearFieldError(errorDiv, errorMsg);
        deleteBtn.style.display = (id === null) ? "none" : "inline-flex";

        return new Promise((resolve, reject) => {
            currentEdit = { id: id, name: name || "", resolve: resolve, reject: reject, resolved: false, editModal: editModal };

            // Load timezone list (cached after first fetch), populate the select,
            // then open — so open() resets _dirty AFTER FormSelect fires its change
            // event, and warpLiftSelect() runs when the .select-wrapper already exists.
            timezoneCache.get().then(function(tzList) {
                var current = timezone || 'UTC';
                planTzEl.innerHTML = '';
                var found = false;
                for (var tz of tzList) {
                    var opt = document.createElement('option');
                    opt.value = tz.id;
                    opt.textContent = tz.label;
                    if (tz.id === current) { opt.selected = true; found = true; }
                    planTzEl.appendChild(opt);
                }
                // If the plan's stored timezone isn't in the common list, add it so
                // the dropdown shows its actual value instead of defaulting to the
                // first entry (which would silently overwrite it on save).
                if (!found && current) {
                    var extra = document.createElement('option');
                    extra.value = current;
                    extra.textContent = current;
                    extra.selected = true;
                    planTzEl.insertBefore(extra, planTzEl.firstChild);
                }
                initFormSelect(planTzEl);
                M.updateTextFields();
                // open() resets _dirty and lifts the now-existing select dropdown.
                editModal.open();
            });
        });
    };

    return function unmount() {
        table.destroy();
    };
}

export default { html, mount };
