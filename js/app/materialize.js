'use strict';

// Materialize 2.x — CSS first so app rules win the cascade, then JS.
// The published sass/materialize.scss is unusable (forwards non-shipped
// files), so we consume the prebuilt dist CSS+JS from the one pinned package.
import '@materializecss/materialize/dist/css/materialize.css';
import 'nouislider/dist/nouislider.css';
import * as Materialize from '@materializecss/materialize';

// Expose Materialize as the global `M` the inline template scripts expect.
// `import * as` yields a frozen module namespace, so we spread it into a
// plain object and add the two 1.x helpers 2.x renamed/removed:
//   M.toast(opts)        -> 2.x dropped the `toast` function; construct a Toast.
//   M.updateTextFields() -> 2.x floats labels via CSS :not(:placeholder-shown);
//      we just ensure inputs carry placeholder=" " so empty-state labels rest.
//   (2.x's Modal is a no-op stub — modals are native <dialog>; WARP drives them
//   through the window.warpDialog controller in dialog.js, not M.Modal.)
//   M.Autocomplete.init  -> 2.x changed `data` to [{id,text}] and onAutocomplete
//      to receive AutocompleteData[]; wrap to accept the 1.x {key:null} map and
//      pass the selected string back, so call sites are unchanged.
const _AcInit = Materialize.Autocomplete.init;
Materialize.Autocomplete.init = function (els, options) {
  if (options && options.data && !Array.isArray(options.data)) {
    var map = options.data;
    options.data = Object.keys(map).map(function (k) {
      return { id: k, text: k, image: map[k] || undefined };
    });
  }
  if (options && options.onAutocomplete) {
    var orig = options.onAutocomplete;
    // 2.x calls onAutocomplete with AutocompleteData[] (and fires it on input-clear
    // with []). 1.x called it only on selection with the chosen string. Only
    // forward when there's a real selection, passing the entry's text/id.
    options.onAutocomplete = function (entries) {
      var e = entries && entries[0];
      if (!e) return;
      // Single-select re-fires on clear/refocus with the same selectedValues.
      // Clear them before forwarding so the re-fire passes [] and is dropped.
      if (!this.options.isMultiSelect) this.selectedValues = [];
      return orig.call(this, e.text || e.id);
    };
  }
  return _AcInit.call(this, els, options);
};

// Re-bind a FormSelect's Dropdown to render its panel as a top-layer popover at
// the trigger's viewport coordinates, flipping above when there's more room on
// top. M2 positions dropdowns with absolute left/top relative to the offset
// parent and never calls showPopover(), so inside a showModal() <dialog> the
// panel is otherwise clipped by / trapped behind the modal.
export function warpLiftSelect(input) {
  // Accept either the FormSelect trigger input or the original <select>.
  if (input && input.tagName === 'SELECT') {
    var wrap = input.closest('.select-wrapper');
    input = wrap && wrap.querySelector('input.select-dropdown');
  }
  if (!input) return;
  var dd = window.M.Dropdown.getInstance(input);
  if (!dd || dd.__warpLifted) return;
  dd.__warpLifted = true;
  dd.open = function () {
    if (dd.isOpen) return;
    dd.isOpen = true;
    if (typeof dd.options.onOpenStart === 'function') dd.options.onOpenStart.call(dd, dd.el);
    var r = dd.el.getBoundingClientRect();
    var de = dd.dropdownEl;
    de.style.display = 'block';
    de.style.opacity = '1';
    de.style.transform = 'none';
    de.style.position = 'fixed';
    de.style.left = r.left + 'px';
    de.style.width = r.width + 'px';
    de.style.height = '';
    var dh = de.offsetHeight;
    var spaceBelow = window.innerHeight - r.bottom;
    var spaceAbove = r.top;
    de.style.top = (dh > spaceBelow && spaceAbove > spaceBelow)
      ? Math.max(8, spaceAbove - dh) + 'px'
      : r.bottom + 'px';
    de.popover = 'manual';
    try { de.showPopover(); } catch (e) {}
    setTimeout(function () { if (dd._setupTemporaryEventHandlers) dd._setupTemporaryEventHandlers(); }, 0);
    dd.el.ariaExpanded = 'true';
  };
  dd.close = function () {
    if (!dd.isOpen) return;
    dd.isOpen = false;
    if (typeof dd.options.onCloseStart === 'function') dd.options.onCloseStart.call(dd, dd.el);
    try { dd.dropdownEl.hidePopover(); } catch (e) {}
    dd.dropdownEl.style.display = 'none';
    if (dd._removeTemporaryEventHandlers) dd._removeTemporaryEventHandlers();
    dd.el.ariaExpanded = 'false';
  };
}

// True when any Materialize dropdown panel is currently visible (a select lifted
// to a top-layer popover, or an autocomplete rendered inline). Used to route Esc
// / outside-click to the dropdown instead of the modal.
export function warpDropdownOpen() {
  var panels = document.querySelectorAll('.dropdown-content');
  for (var i = 0; i < panels.length; i++) {
    var p = panels[i];
    if (p.matches(':popover-open')) return true;
    var cs = getComputedStyle(p);
    if (cs.display !== 'none' && cs.opacity !== '0' && p.getClientRects().length) return true;
  }
  return false;
}

export const M = Object.assign({}, Materialize, {
  toast: function (opts) { return new Materialize.Toast(opts); },
  updateTextFields: function () {
    document.querySelectorAll(
      '.input-field input:not([placeholder]), .input-field textarea:not([placeholder])'
    ).forEach(function (el) { el.setAttribute('placeholder', ' '); });
  },
});
window.M = M;

export default M;
