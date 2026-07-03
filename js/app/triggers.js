'use strict';

import { M } from './materialize.js';
import warpDialog from './dialog.js';

// Materialize 2.x removed the .modal-trigger / .sidenav-trigger auto-init
// classes (click-to-open was automatic in 1.x). Replicate that behaviour with
// delegated listeners so it covers triggers added dynamically by view JS, and
// so it works regardless of init order or view mount/unmount. Sidenav triggers
// are guarded to real .sidenav elements only — WARP reuses sidenav-trigger on
// the zone sidepanel (a plain div, not a Materialize sidenav), which must keep
// its own handling.
export function initTriggerClasses() {
  document.addEventListener('click', function(ev) {
    // Selecting a destination inside the mobile sidenav must close it. The
    // pre-SPA app got this for free (every nav click was a full page load);
    // under the SPA router only #view-root changes, so an open sidenav would
    // stay covering the new view. Runs for any in-sidenav link EXCEPT the
    // collapsible group headers (Admin / <login>), which toggle their submenu
    // and must keep the sidenav open. Not exclusive with the trigger handling
    // below — a .modal-trigger item in the sidenav both closes the sidenav
    // and opens its modal.
    var snLink = ev.target.closest && ev.target.closest('.sidenav a');
    if (snLink && !snLink.classList.contains('collapsible-header')) {
      var snInst = M.Sidenav.getInstance(snLink.closest('.sidenav'));
      if (snInst) snInst.close();
    }

    var modalTrig = ev.target.closest && ev.target.closest('.modal-trigger');
    if (modalTrig) {
      var sel = modalTrig.getAttribute('href');
      if (sel && sel !== '#') {
        var modalEl = document.querySelector(sel);
        if (modalEl) {
          ev.preventDefault();
          warpDialog(modalEl).open();
        }
      }
      return;
    }
    var sidenavTrig = ev.target.closest && ev.target.closest('.sidenav-trigger');
    if (sidenavTrig) {
      var id = sidenavTrig.getAttribute('data-target');
      var sn = id && document.getElementById(id);
      if (sn && sn.classList.contains('sidenav')) {
        ev.preventDefault();
        (M.Sidenav.getInstance(sn) || M.Sidenav.init(sn, {})).open();
      }
      return;
    }
    // .modal-close: 2.x dropped the auto-close class behaviour; close the
    // enclosing <dialog class="modal"> (instance.close() if init'd, else native close).
    var modalClose = ev.target.closest && ev.target.closest('.modal-close');
    if (modalClose) {
      var dlg = modalClose.closest('.modal');
      if (dlg) {
        ev.preventDefault();
        var inst = warpDialog.getInstance(dlg);
        if (inst) inst.close(); else dlg.close();
      }
    }
  });
}
