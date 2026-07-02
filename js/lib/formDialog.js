'use strict';

import warpDialog from '../app/dialog.js';

// Wraps the "open a form <dialog>, resolve with the user's action" pattern
// shared by every admin edit dialog (users/groups/zones/plans/plan seat
// edit): Save resolves {action:'save', ...validate()}; Delete resolves
// {action:'delete'} after its own confirmation (if `confirmDelete` given);
// Esc/outside-click on a clean form, or an explicit Cancel, rejects with no
// value (a plain "the user backed out", not an error — callers .catch(()=>{})).
//
// The dialog element is recreated per view mount (router.js replaces
// #view-root wholesale), so listeners are wired fresh on every open() call —
// no idempotency guard needed, and no leak across navigations.
//
// `validate` returns the save payload (any plain object, spread onto the
// resolved value) or `null`/`false` to reject the click and keep the dialog
// open (having already shown its own field error, e.g. via showFieldError).
export function openFormDialog(modalEl, { saveBtn, deleteBtn, validate, confirmDelete } = {}) {
  var dialog = warpDialog(modalEl);

  return new Promise(function (resolve, reject) {
    var resolved = false;

    function onSaveClick() {
      var result = validate ? validate() : {};
      if (result === false || result == null) return; // validate() already showed its own error
      resolved = true;
      dialog.close();
      resolve(Object.assign({ action: 'save' }, result));
    }

    function onDeleteClick() {
      var proceed = confirmDelete ? confirmDelete() : Promise.resolve(true);
      Promise.resolve(proceed).then(function (ok) {
        if (!ok) return;
        resolved = true;
        dialog.close();
        resolve({ action: 'delete' });
      });
    }

    if (saveBtn) saveBtn.addEventListener('click', onSaveClick);
    if (deleteBtn) deleteBtn.addEventListener('click', onDeleteClick);

    dialog.options.onCloseStart = function () {
      if (saveBtn) saveBtn.removeEventListener('click', onSaveClick);
      if (deleteBtn) deleteBtn.removeEventListener('click', onDeleteClick);
      if (!resolved) reject();
    };

    dialog.open();
  });
}

export function showFieldError(errorDiv, errorMsg, text) {
  errorMsg.innerText = text;
  errorDiv.style.display = 'block';
}

export function clearFieldError(errorDiv, errorMsg) {
  errorDiv.style.display = 'none';
  errorMsg.innerText = '';
}

export default { openFormDialog, showFieldError, clearFieldError };
