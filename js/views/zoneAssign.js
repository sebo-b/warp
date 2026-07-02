"use strict";

import html from './html/zoneAssign.html';
import Utils from './modules/utils.js';
import { userTypeFormatter, userGroupLinkFormatter, iconFormatter, labelFormatter } from '../lib/formatters.js';
import { createTable } from '../lib/tablePage.js';
import { confirmDelete } from '../lib/confirmDelete.js';
import warpDialog from '../app/dialog.js';
import { M } from '../app/materialize.js';

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

    const returnURL = ctx.query.return || '/zones';
    root.querySelector('#zone_assign_return_link').setAttribute('href', returnURL);

    let zoneRoles = [
        {label: "---" },
        {label: TR("zoneRoles.ZoneAdmin"), value: 10 },
        {label: TR("zoneRoles.User"), value: 20 },
        {label: TR("zoneRoles.Viewer"), value: 30 }
    ];
    let defaultZoneRole = 20;
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
    var assignToZoneModalEl = root.querySelector('#assign_to_zone_modal');
    var assignToZoneModalHeader = root.querySelector('#assign_to_zone_modal_header');
    var assignToZoneModaAutocompleteEl = root.querySelector('#assign_to_zone_autocomplete');

    let assignToZoneTable;
    let assignToZoneModal;

    assignToZoneBtn.addEventListener('click', function(e) {

        let showModal = function() {
            assignToZoneTable.clearData();
            assignToZoneModal.open();
        }

        let initModal = function(usersData) {

            assignToZoneModal = warpDialog(assignToZoneModalEl);
            if (assignToZoneModalHeader) {
                assignToZoneModalHeader.textContent = TR("Assign to zone: %{zone_name}", {zone_name: zoneName});
            }

            let assignToZoneTableRemoveClicked = function(e, cell) {
                cell.getRow().delete();
            }

            root.querySelector('#assign_to_zone_modal_addbtn').addEventListener('click', function(e) {

                let payload = {
                    zid: zid,
                    change: assignToZoneTable.getData().map(
                        (a) => ({'login': a['login'], 'role': a['zone_role']}))
                }

                Utils.xhr.post(window.warpGlobals.URLs['zoneAssignXHR'], payload)
                    .then(() => { table.replaceData(); });
            }, {signal: ctx.signal});

            assignToZoneTable = createTable(root.querySelector('#assign_to_zone_table'), {
                remote: false,
                height: "200px",
                index: "login",
                headerVisible: false,
                columns: [
                    {formatter: iconFormatter({icon: "disabled_by_default", colorClass: "warp-icon-danger", iconClass: "material-icons"}), width: 40, hozAlign: "center", cellClick: assignToZoneTableRemoveClicked},
                    {field: "name"},
                    {field: "zone_role", editor: Utils.makeSelect(zoneRoles), formatter: zoneRoleFormatter},
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
                assignToZoneTable.updateOrAddData([{"login": u[0], "name": u[1], "zone_role": defaultZoneRole}]);
                assignToZoneModaAutocompleteEl.value = "";
                assignToZoneModaAutocompleteEl.focus();
            }

            M.Autocomplete.init(assignToZoneModaAutocompleteEl, {
                data: autocompleteData,
                dropdownOptions: {
                    constrainWidth: true,
                    container: assignToZoneModaAutocompleteEl.closest('dialog') || root
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
        if (assignToZoneTable) assignToZoneTable.destroy();
    };
}

export default { html, mount };
