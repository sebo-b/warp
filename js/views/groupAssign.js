"use strict";

import html from './html/groupAssign.html';
import Utils from './modules/utils.js';
import { userTypeFormatter, userGroupLinkFormatter, iconFormatter } from '../lib/formatters.js';
import { createTable } from '../lib/tablePage.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import { createUserPicker } from './modules/userPicker.js';

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

    const returnURL = safeReturn(ctx.query.return, window.warpGlobals.URLs['groups']);
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

    let userPicker = createUserPicker({
        btnEl: addToGroupBtn,
        modalEl: root.querySelector('#add_to_group_modal'),
        headerEl: root.querySelector('#add_to_group_modal_header'),
        autocompleteEl: root.querySelector('#add_to_group_autocomplete'),
        tableEl: root.querySelector('#addToGroupTable'),
        addBtnEl: root.querySelector('#add_to_group_modal_addbtn'),
        dropdownContainer: root,
        titleText: TR("Add to group %{group}", {group: groupName}),
        signal: ctx.signal,
        columns: [
            {formatter: iconFormatter({icon: "disabled_by_default", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: function (e, cell) { cell.getRow().delete(); }},
            {field: "name"},
        ],
        rowFromLogin: function (login, name) { return { login: login, name: name }; },
        onAdd: function (rows) {
            Utils.xhr.post(
                window.warpGlobals.URLs['groupsAssignXHR'],
                { groupLogin: groupLogin, add: rows.map(function (a) { return a['login']; }) }
            ).then(function () { table.replaceData(); });
        }
    });

    addToGroupBtn.addEventListener('click', function () { userPicker.open(); }, {signal: ctx.signal});

    return function unmount() {
        table.destroy();
        userPicker.destroy();
    };
}

export default { html, mount };
