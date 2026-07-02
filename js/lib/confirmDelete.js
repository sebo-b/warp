'use strict';

import WarpModal from '../views/modules/modal.js';

// Wraps the shared Yes/No WarpModal confirmation used by every delete flow
// (6 near-identical call sites across users/groups/zones/plans/assigns) in a
// Promise: resolves true if the user confirmed, false if they clicked No.
// Dismissing without a button (Esc / outside-click) never resolves — same
// as today's behaviour, where an unhandled dismiss just leaves the confirm
// closed with nothing done.
export function confirmDelete(title, message, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    WarpModal.getInstance().open(title, message || '', {
      buttons: [
        { id: 1, text: opts.yesText || TR('btn.Yes') },
        { id: 0, text: opts.noText || TR('btn.No') }
      ],
      onButtonHook: function (buttonId) { resolve(buttonId === 1); },
      // Esc / outside-click dismisses with no button clicked — resolve false
      // (treat as "no") so the caller's .then() runs and its closures (table,
      // editModal, …) are released instead of lingering on an unresolved promise.
      onCancelHook: function () { resolve(false); }
    });
  });
}

export default confirmDelete;
