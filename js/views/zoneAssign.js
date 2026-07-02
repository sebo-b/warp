"use strict";

import html from './html/zoneAssign.html';
import Utils from './modules/utils.js';
import { userTypeFormatter, userGroupLinkFormatter, iconFormatter, labelFormatter } from '../lib/formatters.js';
import { createTable } from '../lib/tablePage.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import { safeReturn } from '../app/routes.js';

export { html };

export async function mount(ctx) {
    const root = ctx.root;
    const zid = parseInt(ctx.params.zid, 10);

    // The old server-side zone-name lookup (view.zoneAssign, dropped in
    // WP1) — a 404/403 here propagates out of mount() and router.js renders
    // the client #view-error state, same as the deep-link case used to.
    const info = await Utils.xhr.get(
        window.warpGlobals.URLs['zoneInfo'].replace('__ZID__', String(zid)),
        { toastOnSuccess: false, errorOnFailure: false });
    const zoneName = info.response.name;

    root.querySelector('#zone_assign_title_text').textContent = TR('Users assigned to: %{zone_name}', {zone_name: zoneName});

    const returnURL = safeReturn(ctx.query.return, window.warpGlobals.URLs['zones']);
    root.querySelector('#zone_assign_return_link').setAttribute('href', returnURL);

    const ZR = window.warpGlobals.zoneRoles;
    let zoneRoles = [
        {label: "---" },
        {label: TR("zoneRoles.ZoneAdmin"), value: ZR.admin },
        {label: TR("zoneRoles.User"), value: ZR.user },
        {label: TR("zoneRoles.Viewer"), value: ZR.viewer }
    ];
    let defaultZoneRole = ZR.user;
    const zoneRoleFormatter = labelFormatter(zoneRoles);

    function deleteClicked(e, cell) {
        let cellData = cell.getRow().getData();
        confirmDelete(
            TR("Are you sure?"),
            TR("Are you sure to unassign %{user} from the zone?", {user: cellData['name']})
        ).then((confirmed) => {
            if (!confirmed) return;
            let payload = { zid: zid, remove: [cellData['login']] };
            Utils.xhr.post(window.warpGlobals.URLs['zoneAssignXHR'], payload)
                .then(() => { table.replaceData(); });
        });
    }

    function zoneRoleChanged(cell) {
        let payload = {
            zid: zid,
            change: [{ login: cell.getData()['login'], role: cell.getValue() }]
        };
        Utils.xhr.post(window.warpGlobals.URLs['zoneAssignXHR'], payload);
    }

    var table = createTable(root.querySelector('#zone_assignees_table'), {
        height: "2000px",
        ajaxURL: window.warpGlobals.URLs['zoneMembers'],
        ajaxParams: {zid: zid},
        index: "login",
        columns: [
            {formatter: iconFormatter({icon: "person_remove", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: deleteClicked, headerSort: false},
            {title: TR("Login"), field: "login", formatter: userGroupLinkFormatter('groupAssign'), headerFilter: "input", headerFilterFunc: "starts"},
            {title: TR("User/group name"), field: "name", formatter: userGroupLinkFormatter('groupAssign'), headerFilter: "input", headerFilterFunc: "starts"},
            {
                title: TR("Zone role"),
                field: "zone_role",
                headerFilter: Utils.makeSelect(zoneRoles), headerFilterFunc: "=",
                editor: Utils.makeSelect(zoneRoles),
                formatter: zoneRoleFormatter
            },
            {formatter: userTypeFormatter, width: 40, hozAlign: "center", headerSort: false},
        ],
        initialSort: [
            {column: "login", dir: "asc"},
            {column: "name", dir: "asc"},
            {column: "zone_role", dir: "asc"}
        ]
    });

    table.on('cellEdited', zoneRoleChanged);

    var assignToZoneBtn = root.querySelector('#assign_to_zone_btn');

    let userPicker = createUserPicker({
        btnEl: assignToZoneBtn,
        modalEl: root.querySelector('#assign_to_zone_modal'),
        headerEl: root.querySelector('#assign_to_zone_modal_header'),
        autocompleteEl: root.querySelector('#assign_to_zone_autocomplete'),
        tableEl: root.querySelector('#assign_to_zone_table'),
        addBtnEl: root.querySelector('#assign_to_zone_modal_addbtn'),
        dropdownContainer: root,
        titleText: TR("Assign to zone: %{zone_name}", {zone_name: zoneName}),
        signal: ctx.signal,
        columns: [
            {formatter: iconFormatter({icon: "disabled_by_default", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: function (e, cell) { cell.getRow().delete(); }},
            {field: "name"},
            {field: "zone_role", editor: Utils.makeSelect(zoneRoles), formatter: zoneRoleFormatter},
        ],
        rowFromLogin: function (login, name) { return { login: login, name: name, zone_role: defaultZoneRole }; },
        onAdd: function (rows) {
            Utils.xhr.post(window.warpGlobals.URLs['zoneAssignXHR'], {
                zid: zid,
                change: rows.map(function (a) { return { login: a['login'], role: a['zone_role'] }; })
            }).then(function () { table.replaceData(); });
        }
    });

    assignToZoneBtn.addEventListener('click', function () { userPicker.open(); }, {signal: ctx.signal});

    return function unmount() {
        table.destroy();
        userPicker.destroy();
    };
}

export default { html, mount };
