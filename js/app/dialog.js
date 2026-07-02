'use strict';

import { warpLiftSelect, warpDropdownOpen } from './materialize.js';

// ---- Native <dialog> controller (replaces the dead Materialize 2.x Modal) ----
// Materialize 2.x ships NO modal JS: `M.Modal` is an empty stub and modals are
// plain native <dialog>. WarpDialog is the single shared controller every WARP
// modal goes through (window.warpDialog). It wraps showModal()/close() with the
// 1.x-style lifecycle hooks the app relies on (onOpenStart/End, onCloseStart/End)
// and centralises the unified dismissal rules so every modal behaves identically:
//   * Esc while a select/autocomplete dropdown is open -> close just the dropdown.
//   * Esc / outside-click with unsaved edits           -> ignored (modal stays).
//   * Esc / outside-click on a clean (or readonly) modal -> Cancel (close).
// It also lifts in-modal <select> dropdowns into the top layer (position:fixed
// popover) so they are never clipped by the <dialog> that owns the top layer.
//
// Dialogs are recreated per view mount (router.js step 2/3), so the DOM element
// this wraps may be replaced wholesale; callers always go through warpDialog(el)
// rather than caching a controller reference across a navigation.
class WarpDialog {
  constructor(el, options) {
    this.el = el;
    this.options = Object.assign({
      dismissible: true,
      onOpenStart: null, onOpenEnd: null,
      onCloseStart: null, onCloseEnd: null
    }, options || {});
    this._dirty = false;       // set by any user edit since the last open()
    this._ddEscaping = false;  // this Esc is closing a dropdown, not the modal
    this._onEdit = function () { this._dirty = true; }.bind(this);
    // Capture phase: runs before Materialize closes the dropdown, so we can see
    // it was open and flag the imminent 'cancel' as a dropdown-dismiss.
    this._onKeydown = function (ev) {
      if (ev.key === 'Escape' && warpDropdownOpen()) this._ddEscaping = true;
    }.bind(this);
    this._onCancel = this._onCancel.bind(this);
    this._onBackdrop = this._onBackdrop.bind(this);
    this._onClose = this._onClose.bind(this);
    el.addEventListener('input', this._onEdit);
    el.addEventListener('change', this._onEdit);
    el.addEventListener('keydown', this._onKeydown, true);
    el.addEventListener('click', this._onBackdrop);
    el.addEventListener('cancel', this._onCancel);
    el.addEventListener('close', this._onClose);
  }
  // Esc. We always preventDefault and manage closing ourselves so the onClose*
  // hooks fire (the native 'close' event alone wouldn't run them).
  _onCancel(ev) {
    ev.preventDefault();
    if (this._ddEscaping) { this._ddEscaping = false; return; } // Esc closed a dropdown
    if (this.options.dismissible === false) return;
    if (this._dirty) return;                                    // unsaved edits -> ignore
    this.close();
  }
  _onBackdrop(ev) {
    if (ev.target !== this.el) return;   // only a click on the backdrop itself
    if (warpDropdownOpen()) return;      // let the click dismiss the dropdown first
    if (this.options.dismissible === false) return;
    if (this._dirty) return;             // unsaved edits -> ignore
    this.close();
  }
  // The native 'close' event fires asynchronously from el.close(); use it only to
  // keep the .open class in sync. onCloseEnd is fired synchronously in close().
  _onClose() { this.el.classList.remove('open'); }
  // For edits that don't surface as a bubbling input/change event (mouse-driven
  // custom widgets: the prefs time slider, calendar weekday chips, ...).
  markDirty() { this._dirty = true; }
  open() {
    this._dirty = false;
    this._ddEscaping = false;
    if (this.options.onOpenStart) this.options.onOpenStart.call(this.el);
    // Lift this modal's <select> dropdowns into the top layer (idempotent).
    this.el.querySelectorAll('.select-wrapper input.select-dropdown').forEach(warpLiftSelect);
    this.el.classList.add('open');
    this.el.showModal();
    // No action button may hold initial focus (a stray Enter would accept the
    // dialog), but edit fields SHOULD: opening a form modal should put the
    // cursor in the first field. showModal() can't tell the two apart, so do it
    // explicitly — focus the first input/textarea/select in the body; if there
    // is none (the generic WarpModal Ok/Cancel and confirm dialogs), fall back
    // to the non-interactive dialog (tabindex=-1) so no button gets focus. Tab
    // still lands on the first control. (dialog.modal:focus suppresses the ring
    // some browsers draw around the modal in the fallback case.)
    var field = this.el.querySelector(
      '.modal-content input:not([type="hidden"]):not([disabled]), ' +
      '.modal-content textarea:not([disabled]), ' +
      '.modal-content select:not([disabled])');
    if (field) {
      field.focus();
    } else {
      this.el.setAttribute('tabindex', '-1');
      this.el.focus();
    }
    var self = this;
    requestAnimationFrame(function () {
      if (self.options.onOpenEnd) self.options.onOpenEnd.call(self.el);
    });
    return this;
  }
  close() {
    if (this.options.onCloseStart) this.options.onCloseStart.call(this.el);
    this.el.close();
    this.el.classList.remove('open');
    if (this.options.onCloseEnd) this.options.onCloseEnd.call(this.el);
    return this;
  }
  destroy() {
    var el = this.el;
    el.removeEventListener('input', this._onEdit);
    el.removeEventListener('change', this._onEdit);
    el.removeEventListener('keydown', this._onKeydown, true);
    el.removeEventListener('click', this._onBackdrop);
    el.removeEventListener('cancel', this._onCancel);
    el.removeEventListener('close', this._onClose);
    el._warpDialog = undefined;
  }
  static getInstance(el) { return el ? el._warpDialog : undefined; }
}

// Create-or-return the controller for a <dialog> — one idempotent call that
// replaces the old M.Modal.getInstance()/init() pair. Passing options on a
// later call updates the live options object (callers mutate onCloseStart etc.).
export function warpDialog(el, options) {
  if (!el) return undefined;
  if (!el._warpDialog) el._warpDialog = new WarpDialog(el, options);
  else if (options) Object.assign(el._warpDialog.options, options);
  return el._warpDialog;
}
warpDialog.getInstance = WarpDialog.getInstance;

window.warpDialog = warpDialog;

export default warpDialog;
