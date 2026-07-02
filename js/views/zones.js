"use strict";

import html from './html/zones.html';
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { M } from '../app/materialize.js';
import warpDialog from '../app/dialog.js';
import { createTable } from '../lib/tablePage.js';
import { initFormSelect } from '../lib/formSelect.js';
import { clearFieldError, showFieldError } from '../lib/formDialog.js';
import { confirmDelete } from '../lib/confirmDelete.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;

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
        let args = [null, "", "10", null, 0];

        if (typeof(cell) === 'object') {
            let data = cell.getRow().getData();
            args = [data['id'], data['name'], data['zone_type'], data['zone_group'] || null, data['seat_count'] || 0];
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
                else if (actionData.action == 'delete') {
                    return Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {id: actionData.id}, {errorOnFailure: false})
                        .then(function() {
                            // 200 = zone had no seats, deleted successfully
                            refreshGroupFilter();
                        })
                        .catch(function(err) {
                            // 409 "Zone has seats" is a normal interactive flow (show modal), not a hard error.
                            if (err && err.response && err.response.code === 230) {
                                return showReassignModal(actionData.id, err.response).then(function() {
                                    refreshGroupFilter();
                                });
                            }
                            // Any other error: surface it
                            throw err;
                        });
                }
            })
            .then(() => table.replaceData())
            // Dismissing the dialog (Esc / outside-click on a clean form) rejects
            // the promise — that's a plain cancel, so swallow it.
            .catch(() => {});
    }

    // Show modal when deleting a zone that has seats.
    // The reassignment modal is only shown when there are actually seats.
    // Appended to ctx.root (not document.body) so a view unmount mid-flow
    // (router.js's root.replaceChildren()) can't leak it.
    function showReassignModal(zid, responseData) {
        return new Promise(function(resolveModal) {
            let otherZones = responseData.other_zones || [];
            let seatCount = responseData.seat_count || 0;
            const hasAlternatives = otherZones.length > 0;

            let modalDiv = document.createElement('dialog');
            modalDiv.className = 'modal warp-form-modal warp-fields warp-modal-sm';
            modalDiv.id = 'reassign_modal';

            // Build content
            let content = document.createElement('div');
            content.className = 'modal-content';

            let title = document.createElement('h5');
            title.textContent = TR('Reassign seats from deleted zone');
            content.appendChild(title);

            // Static info about bookings at the top
            let info = document.createElement('p');
            info.innerHTML =
                TR('This zone contains %{smart_count} seat(s). All past booking history for these seats will be permanently deleted.', {smart_count: seatCount});
            content.appendChild(info);

            if (hasAlternatives) {
                let p = document.createElement('p');
                p.textContent = TR('Select a zone to reassign seats to, or use the button below to delete the seats without reassignment.');
                content.appendChild(p);

                let field = document.createElement('div');
                field.className = 'input-field outlined';  // Materialize outlined text-field variant
                let sel = document.createElement('select');
                sel.id = 'reassign_zone_select';
                for (let z of otherZones) {
                    let opt = document.createElement('option');
                    opt.value = z.id;
                    opt.textContent = z.name;
                    sel.appendChild(opt);
                }
                field.appendChild(sel);
                content.appendChild(field);
            } else {
                let p = document.createElement('p');
                p.textContent = TR('No other zones exist. You may only delete the seats along with this zone.');
                content.appendChild(p);
            }

            modalDiv.appendChild(content);

            // Footer
            let footer = document.createElement('div');
            footer.className = 'modal-footer';

            // Red delete seats button (always shown when we reached this modal)
            let delBtn = document.createElement('a');
            delBtn.href = '#!';
            delBtn.className = 'waves-effect waves-light btn warp-btn-danger';
            delBtn.id = 'reassign_delete_seats';
            delBtn.textContent = TR('Delete seats');
            footer.appendChild(delBtn);

            if (hasAlternatives) {
                let moveBtn = document.createElement('a');
                moveBtn.href = '#!';
                moveBtn.className = 'waves-effect waves-light btn';
                moveBtn.id = 'reassign_move_btn';
                moveBtn.textContent = TR('Reassign seats');
                footer.appendChild(moveBtn);
            }

            let cancelBtn = document.createElement('a');
            cancelBtn.href = '#!';
            cancelBtn.className = 'modal-close waves-effect waves-light btn-flat';
            cancelBtn.textContent = TR('btn.Cancel');
            footer.appendChild(cancelBtn);

            modalDiv.appendChild(footer);
            root.appendChild(modalDiv);

            let modalInstance = warpDialog(modalDiv);
            modalInstance.open();

            // Initialize Materialize select (must be after attached to DOM)
            let reassignSelect = modalDiv.querySelector('#reassign_zone_select');
            if (reassignSelect) {
                initFormSelect(reassignSelect, {
                    dropdownOptions: {
                        container: modalDiv,
                        constrainWidth: false
                    }
                });
            }

            let moveBtnEl = modalDiv.querySelector('#reassign_move_btn');
            let deleteSeatsBtn = modalDiv.querySelector('#reassign_delete_seats');

            function cleanup() {
                modalInstance.close();
                setTimeout(function() {
                    modalDiv.remove();
                }, 300);
            }

            if (deleteSeatsBtn) {
                deleteSeatsBtn.addEventListener('click', function() {
                    // Extra confirmation for the destructive "delete seats" path
                    cleanup();
                    confirmDelete(
                        TR('Delete %{smart_count} seat(s) permanently?', {smart_count: seatCount}),
                        TR('This will remove the seats and all their past booking history. This cannot be undone.'),
                        {yesText: TR('btn.Yes, delete'), noText: TR('btn.Cancel')}
                    ).then((confirmed) => {
                        if (confirmed) {
                            Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {
                                id: zid,
                                delete_seats: true
                            }).then(function() { resolveModal(); });
                        } else {
                            // user cancelled the inner confirm — we are done with this flow
                            resolveModal();
                        }
                    });
                });
            }

            if (hasAlternatives && moveBtnEl) {
                moveBtnEl.addEventListener('click', function() {
                    let targetZid = parseInt(reassignSelect ? reassignSelect.value : 0);
                    cleanup();
                    Utils.xhr.post(window.warpGlobals.URLs['zonesDelete'], {
                        id: zid,
                        reassign_zid: targetZid
                    }).then(function() { resolveModal(); });
                });
            }
        });
    }

    var clickFuncFactory = function(targetURL) {
        return function(e, cell) {
            let zid = cell.getRow().getData()['id'];
            let url = window.warpGlobals.URLs[targetURL].replace('__ZID__', zid);
            ctx.navigate(url);
        }
    }

    root.querySelector('#add_zone_btn').addEventListener('click', addEditClicked, {signal: ctx.signal});

    table = createTable(root.querySelector('#zonesTable'), {
        ajaxURL: window.warpGlobals.URLs['zonesList'],
        index: "id",
        columns: [
            {formatter: iconFormater, formatterParams: {icon: "manage_accounts", colorClass: "warp-icon-edit"}, width: 40, hozAlign: "center", cellClick: clickFuncFactory('zoneAssign'), headerSort: false, tooltip: TR('Manage users')},
            {formatter: iconFormater, formatterParams: {icon: "edit", colorClass: "warp-icon-edit"}, width: 40, hozAlign: "center", cellClick: addEditClicked, headerSort: false, tooltip: TR('Edit zone')},
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

    var editModalEl = root.querySelector('#edit_modal');
    var zoneNameEl = root.querySelector("#zone_name");
    var zoneTypeEl = root.querySelector("#zone_type");
    var zoneGroupEl = root.querySelector("#zone_group");
    var zoneGroupHelperEl = root.querySelector("#zone_group_helper");
    var errorDiv = root.querySelector('#error_div');
    var errorMsg = root.querySelector('#error_message');
    var saveBtn = root.querySelector('#edit_modal_save_btn');
    var deleteBtn = root.querySelector('#edit_modal_delete_btn');

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
    zoneGroupEl.addEventListener('input', updateGroupHelper, {signal: ctx.signal});

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
                    dropdownOptions: { constrainWidth: false, container: zoneGroupEl.closest('dialog') || root },
                    onAutocomplete: updateGroupHelper
                });
                zoneGroupEl._warpGroups = groups;
                updateGroupHelper();
            });
    }

    showEditDialog = function(id, name, zoneType, zoneGroup, seatCount) {

        var editModal = warpDialog.getInstance(editModalEl);
        if (typeof(editModal) === 'undefined') {
            editModal = warpDialog(editModalEl);
        }

        var zoneName = name || "";
        zoneNameEl.value = zoneName;
        zoneTypeEl.value = zoneType != null ? String(zoneType) : "10";
        zoneGroupEl.value = zoneGroup || "";
        zoneGroupEl._warpGroups = [];
        zoneGroupHelperEl.style.display = "none";
        setupGroupAutocomplete();
        clearFieldError(errorDiv, errorMsg);
        deleteBtn.style.display = (id === null) ? "none" : "inline-flex";

        // (Re)initialize Materialize select for zone type (styled version, not browser-default).
        // Render the dropdown into the dialog so it isn't clipped by the modal-content overflow.
        initFormSelect(zoneTypeEl, { dropdownOptions: { container: editModalEl } });

        M.updateTextFields();
        editModal.open();

        return new Promise((resolve, reject) => {

            let resolved = false;

            function onClick(e) {
                switch (e.target) {
                    case saveBtn: {
                        if (zoneNameEl.value === "") {
                            showFieldError(errorDiv, errorMsg, TR('Zone name cannot be empty.'));
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
                        if (seatCount > 0) {
                            // Zone has seats: skip simple confirmation, directly attempt delete
                            // which will return 409 and trigger the reassignment modal.
                            resolved = true;
                            editModal.close();
                            resolve({action: 'delete', id: id});
                        } else {
                            // Zone has no seats: simple confirmation dialog
                            confirmDelete(
                                TR("Are you sure to delete zone: %{zone_name}", {zone_name: zoneName}),
                                TR("This action cannot be undone.")
                            ).then((confirmed) => {
                                if (confirmed) {
                                    resolved = true;
                                    editModal.close();
                                    resolve({action: 'delete', id: id});
                                }
                            });
                        }
                        break;
                }
            }

            saveBtn.addEventListener('click', onClick, {signal: ctx.signal});
            deleteBtn.addEventListener('click', onClick, {signal: ctx.signal});

            editModal.options.onCloseStart = function() {
                if (!resolved)
                    reject();
            };
        });
    }

    return function unmount() {
        table.destroy();
    };
}

export default { html, mount };
