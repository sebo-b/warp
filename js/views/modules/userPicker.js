'use strict';

// Shared "pick users into a staging table, then POST them" modal used by both
// assign views (groupAssign / zoneAssign). The two used to carry a near-verbatim
// ~85-line clone (lazy modal init, the one-time usersList fetch, the staging
// Tabulator, the name-\u003e[login,name] autocomplete roundtrip) that had already
// drifted (one set the header per-open, the other once; one used innerHTML, the
// other textContent). This module owns the shared skeleton; each view supplies
// its columns, its header text, and an onAdd(rows) that builds + POSTs its own
// payload (the two payloads differ in shape: {groupLogin, add:[...]} vs
// {zid, change:[{login, role}]}).
//
// The staging table is created once (first open) and reused; clearData() on
// every open. Destroyed by the view's unmount() so a leaked Tabulator doesn't
// keep its DOM listeners alive after the view is gone.

import Utils from './utils.js';
import { createTable } from '../../lib/tablePage.js';
import warpDialog from '../../app/dialog.js';
import { M } from '../../app/materialize.js';

export function createUserPicker(opts) {
  var modal = undefined;   // undefined = not yet built; null/instance once built
  var pickerTable = null;

  function build() {
    return Utils.xhr.post(window.warpGlobals.URLs['usersList'], {}, { toastOnSuccess: false })
      .then(function (value) {
        modal = warpDialog(opts.modalEl);
        if (opts.headerEl) opts.headerEl.textContent = opts.titleText;

        opts.addBtnEl.addEventListener('click', function () {
          var rows = pickerTable.getData();
          if (!rows.length) return;
          opts.onAdd(rows);
        }, { signal: opts.signal });

        pickerTable = createTable(opts.tableEl, {
          remote: false,
          height: opts.tableHeight || '200px',
          index: 'login',
          headerVisible: false,
          columns: opts.columns,
          initialSort: [{ column: 'name', dir: 'asc' }]
        });

        var autocompleteData = [];
        for (var i of value.response['data']) {
          var label = Utils.makeUserStr(i['login'], i['name']);
          autocompleteData.push({ id: label, text: label });
        }

        M.Autocomplete.init(opts.autocompleteEl, {
          data: autocompleteData,
          dropdownOptions: {
            constrainWidth: true,
            container: opts.autocompleteEl.closest('dialog') || opts.dropdownContainer
          },
          minLength: 2,
          limit: 10,
          onAutocomplete: function (selectedLabel) {
            var u = Utils.makeUserStrRev(selectedLabel);
            pickerTable.updateOrAddData([opts.rowFromLogin(u[0], u[1])]);
            opts.autocompleteEl.value = '';
            opts.autocompleteEl.focus();
          }
        });
      });
  }

  return {
    open: function () {
      if (modal === undefined) {
        build().then(function () { pickerTable.clearData(); modal.open(); });
      } else {
        pickerTable.clearData();
        modal.open();
      }
    },
    destroy: function () {
      if (pickerTable) pickerTable.destroy();
    }
  };
}

export default createUserPicker;