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
        modal = warpDialog(opts.modalEl, {
          // Ephemeral edit: clear any leftover typed-but-not-selected text when
          // the picker closes so a reopen starts clean (otherwise the partial
          // query survives the open/close sequence).
          onCloseEnd: function () { opts.autocompleteEl.value = ''; }
        });
        if (opts.headerEl) opts.headerEl.textContent = opts.titleText;

        opts.addBtnEl.addEventListener('click', function () {
          if (!pickerTable) return; // table is created one rAF after open
          var rows = pickerTable.getData();
          if (!rows.length) return;
          opts.onAdd(rows);
        }, { signal: opts.signal });

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

        // Open the dialog BEFORE creating the staging table: a <dialog> is
        // display:none until opened, so the table element has 0 dimensions and
        // Tabulator's renderer initializes to null, leaving every later
        // adjustTableSize() to throw on a null renderer.verticalFillMode and the
        // staging table non-functional. showModal() makes the dialog visible
        // synchronously, but the browser does not flush layout until the next
        // frame, so defer createTable one rAF and only resolve build() once the
        // table exists (open() clears it right after).
        modal.open();

        return new Promise(function (resolve) {
          requestAnimationFrame(function () {
            pickerTable = createTable(opts.tableEl, {
              remote: false,
              height: opts.tableHeight || '200px',
              index: 'login',
              headerVisible: false,
              columns: opts.columns,
              initialSort: [{ column: 'name', dir: 'asc' }]
            });
            resolve();
          });
        });
      });
  }

  return {
    open: function () {
      if (modal === undefined) {
        // build() opens the modal and creates an empty staging table; no
        // clearData needed on first open (it is already empty, and calling it
        // on a just-created table trips a Tabulator null-renderer path).
        build();
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