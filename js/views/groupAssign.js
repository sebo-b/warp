"use strict";

import html from './html/groupAssign.html';
import Utils from './modules/utils.js';
import { userTypeFormatter, userGroupLinkFormatter, iconFormatter } from '../lib/formatters.js';
import { createTable } from '../lib/tablePage.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import warpDialog from '../app/dialog.js';
import { M } from '../app/materialize.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;
    const groupLogin = ctx.params.group_login;

    // The old server-side group-name lookup (view.groupAssign, dropped in
    // WP1) — a 404/403 here propagates out of mount() and router.js renders
    // the client #view-error state, same as the deep-link case used to.
    const info = await Utils.xhr.get(
        window.warpGlobals.URLs['groupInfo'].replace('__LOGIN__', groupLogin),
        { toastOnSuccess: false, errorOnFailure: false });
    const groupName = info.response.name;

    root.querySelector('#group_assign_title_text').textContent = TR('Members of: %{group}', {group: groupName});

    const returnURL = ctx.query.return || '/groups';
    root.querySelector('#group_assign_return_link').setAttribute('href', returnURL);

    var table = createTable(root.querySelector('#groupMembersTable'), {
        height: "2000px",
        ajaxURL: window.warpGlobals.URLs['groupMemberList'],
        ajaxParams: {groupLogin: groupLogin},
        index: "login",
        columns: [
            {formatter: iconFormatter({icon: "person_remove", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: deleteClicked, headerSort: false},
            {title: TR("Login"), field: "login", formatter: userGroupLinkFormatter('groupAssign'), headerFilter: "input", headerFilterFunc: "starts"},
            {title: TR("User/group name"), field: "name", formatter: userGroupLinkFormatter('groupAssign'), headerFilter: "input", headerFilterFunc: "starts"},
            {formatter: userTypeFormatter, width: 40, hozAlign: "center", headerSort: false},
        ],
        initialSort: [
            {column: "login", dir: "asc"},
            {column: "name", dir: "asc"}
        ]
    });

    function deleteClicked(e, cell) {
        let cellData = cell.getRow().getData();
        confirmDelete(
            TR("Are you sure?"),
            TR("Are you sure to remove %{user} from group %{group}?", {user: cellData['name'], group: groupName})
        ).then((confirmed) => {
            if (!confirmed) return;
            Utils.xhr.post(
                window.warpGlobals.URLs['groupsAssignXHR'],
                { groupLogin: groupLogin, remove: [cellData['login']] }
            ).then(() => { table.replaceData(); });
        });
    }

    var addToGroupBtn = root.querySelector('#add_to_group_btn');
    var addToGroupModalEl = root.querySelector('#add_to_group_modal');
    var addToGroupModalHeader = root.querySelector('#add_to_group_modal_header');
    var addToGroupModaAutocompleteEl = root.querySelector('#add_to_group_autocomplete');

    let addToGroupTable;
    let addToGroupModal;

    addToGroupBtn.addEventListener('click', function(e) {

        let showModal = function() {
            addToGroupModalHeader.innerHTML = TR("Add to group %{group}", {group: groupName});
            addToGroupTable.clearData();
            addToGroupModal.open();
        }

        let initModal = function(usersData) {

            addToGroupModal = warpDialog(addToGroupModalEl);

            let addToGroupTableRemoveClicked = function(e, cell) {
                cell.getRow().delete();
            }

            root.querySelector('#add_to_group_modal_addbtn').addEventListener('click', function(e) {

                let addData = addToGroupTable.getData().map(a => a['login']);
                if (addData.length == 0)
                    return;

                Utils.xhr.post(
                    window.warpGlobals.URLs['groupsAssignXHR'],
                    { groupLogin: groupLogin, add: addData }
                ).then(() => { table.replaceData(); });
            }, {signal: ctx.signal});

            addToGroupTable = createTable(root.querySelector('#addToGroupTable'), {
                remote: false,
                height: "200px",
                index: "login",
                headerVisible: false,
                columns: [
                    {formatter: iconFormatter({icon: "disabled_by_default", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: addToGroupTableRemoveClicked},
                    {field: "name"},
                ],
                initialSort: [
                    {column: "name", dir: "asc"}
                ]
            });

            let autocompleteData = [];
            for (let i of usersData) {
                let label = Utils.makeUserStr(i['login'], i['name']);
                autocompleteData.push({ id: label, text: label });
            }

            let onAutocomplete = function(selectedLabel) {
                var u = Utils.makeUserStrRev(selectedLabel);
                addToGroupTable.updateOrAddData([{"login": u[0], "name": u[1]}]);
                addToGroupModaAutocompleteEl.value = "";
                addToGroupModaAutocompleteEl.focus();
            }

            M.Autocomplete.init(addToGroupModaAutocompleteEl, {
                data: autocompleteData,
                dropdownOptions: {
                    constrainWidth: true,
                    container: addToGroupModaAutocompleteEl.closest('dialog') || root
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
            .then(function(value) {
                initModal(value.response['data']);
                showModal();
            });

        }
        else {
            showModal();
        }
    }, {signal: ctx.signal});

    return function unmount() {
        table.destroy();
        if (addToGroupTable) addToGroupTable.destroy();
    };
}

export default { html, mount };
