"use strict";

import html from './html/groups.html';
import Utils from './modules/utils.js';
import WarpModal from './modules/modal.js';
import { M } from '../app/materialize.js';
import warpDialog from '../app/dialog.js';
import { createTable } from '../lib/tablePage.js';
import { clearFieldError, showFieldError } from '../lib/formDialog.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import { iconFormatter } from '../lib/formatters.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;

    var iconFormater = iconFormatter();   // material-icons-outlined, the old inline default

    var showEditDialog;

    var editClicked = function(e,cell) {
        let data = cell.getRow().getData();
        showEditDialog(data.login, data.name);
    }

    root.querySelector('#add_user_btn').addEventListener('click', function(e) {
        showEditDialog();
    }, {signal: ctx.signal});

    // The "assign" cell is a plain link — same-origin, registered-route clicks
    // are intercepted by the router (app/router.js), so this is a normal SPA
    // navigation, not a full page load.
    var assignFormatter = function(cell) {
        let login = cell.getRow().getData()['login'];
        let url = window.warpGlobals.URLs['groupAssign'].replace('__LOGIN__', login);
        // spaURLs is rendered once at shell boot (not per-route), so the
        // "back to here" query param can't be baked into the URL server-side
        // anymore — append it from the current location.
        url += '?return=' + encodeURIComponent(window.location.pathname + window.location.search);
        return '<a href="' + url + '" class="warp-icon-link"><i class="material-icons-outlined warp-icon-edit">manage_accounts</i></a>';
    };

    var table = createTable(root.querySelector('#groupsTable'), {
        ajaxURL: window.warpGlobals.URLs['usersList'],
        index:"login",
        columns: [
            {formatter:assignFormatter, width:40, hozAlign:"center", headerSort:false},
            {formatter:iconFormater, formatterParams:{icon:"edit",colorClass:"warp-icon-edit"}, width:40, hozAlign:"center", cellClick:editClicked, headerSort:false},
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

        var editModalEl = root.querySelector('#edit_modal');
        var editModal = warpDialog.getInstance(editModalEl);

        var loginEl = root.querySelector("#login");
        var nameEl = root.querySelector("#name");

        var saveBtn = root.querySelector('#edit_modal_save_btn');
        var deleteBtn = root.querySelector('#edit_modal_delete_btn');

        var errorDiv = root.querySelector("#error_div");
        var errorMsg = root.querySelector("#error_message");

        if (typeof(editModal) === 'undefined') {

            editModal = warpDialog(editModalEl);

            var saveBtnClicked = function(e) {

                let err = "";

                if (nameEl.value === "")
                    err = TR("Group name cannot be empty.");

                if (err) {
                    showFieldError(errorDiv, errorMsg, err);
                    return;
                }

                clearFieldError(errorDiv, errorMsg);

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
                    showFieldError(errorDiv, errorMsg, value.errorMsg);
                });
            }

            var deleteBtnClicked = function(e) {
                confirmDelete(
                    TR("Are you sure to delete group: %{group}", {group:loginEl.value}),
                    ""
                ).then((confirmed) => {
                    if (!confirmed) return;
                    Utils.xhr.post(
                        window.warpGlobals.URLs['usersDelete'],
                        { login: loginEl.value })
                    .then( () => {
                        table.replaceData();
                        editModal.close();
                    });
                });
            };

            saveBtn.addEventListener('click', saveBtnClicked, {signal: ctx.signal});
            deleteBtn.addEventListener('click', deleteBtnClicked, {signal: ctx.signal});
        }

        login = login || "";
        name = name || "";

        loginEl.value = login;
        loginEl.disabled = login !== "";

        deleteBtn.style.display =
            login !== "" ? "inline-flex": "none";

        nameEl.value = name;

        clearFieldError(errorDiv, errorMsg);

        M.updateTextFields();
        editModal.open();
    }

    return function unmount() {
        table.destroy();
    };
}

export default { html, mount };
