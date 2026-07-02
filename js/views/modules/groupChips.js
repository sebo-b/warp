"use strict";

// Small self-contained "chips with autocomplete" widget for the user-edit modal
// (assign a user to groups). It replaces Materialize 2.x Chips+Autocomplete,
// which were unreliable here: Chips computes the delete index from the chip's
// position among *all* DOM siblings, but deletes from a separate internal array
// — the two desync as soon as the Autocomplete's injected status-info div / moved
// dropdown <ul> sit among the chips, so a freshly added chip deletes the wrong
// one or throws. This widget tracks state in a plain array and deletes a chip by
// identity (its own close-button handler), so there is no index to desync.
//
// Behaviour:
//  - setData(source, selected): (re)initialise with the selectable groups and the
//    initially-assigned ones.
//  - typing filters `source` (case-insensitive, >= minLength chars), excluding
//    already-chosen groups, into a dropdown.
//  - picking a suggestion (click / Enter) adds a chip unless already present.
//  - the chip's × removes it, whether pre-filled or just added.
//  - getData() returns the current selection for saving.
export default class GroupChips {

    constructor(chipsEl, options = {}) {
        this.chipsEl = chipsEl;
        this.minLength = options.minLength ?? 1;

        // The suggestion dropdown must live OUTSIDE the chips box: inside a
        // <dialog> opened with showModal() the .modal-content scroll box
        // (overflow:auto) both clips and paints over an absolutely-positioned
        // child, so a dropdown nested there is invisible. Appending it directly
        // to the dialog (as app/materialize.js does for every FormSelect here)
        // escapes that;
        // we then position it under the input by hand. Falls back to the chips
        // box when no container is given.
        this.dropdownContainer = options.dropdownContainer || chipsEl;

        // NB: add the `chips` class at runtime (not in markup) so Materialize's
        // DOMContentLoaded `.chips` auto-scan — which wires a broken close handler
        // — never matches this element. We own all behaviour here.
        chipsEl.classList.add('chips', 'input-field');
        chipsEl.replaceChildren();

        this.source = [];     // [{id, text}] all selectable groups
        this.selected = [];   // [{id, text}] current chips
        this.activeIndex = -1;

        this.input = document.createElement('input');
        this.input.type = 'text';
        this.input.className = 'input';
        this.input.setAttribute('autocomplete', 'off');
        if (options.placeholder) this.input.placeholder = options.placeholder;

        this.dropdown = document.createElement('ul');
        this.dropdown.className = 'dropdown-content autocomplete-content group-chips-dropdown';
        this.dropdown.style.display = 'none';

        chipsEl.append(this.input);
        this.dropdownContainer.append(this.dropdown);
        this._bindEvents();
    }

    // Replace the whole state: selectable groups + initially-selected chips.
    setData(source, selected) {
        this.source = source.slice();
        this.selected = [];
        this.input.value = '';
        this._closeDropdown();
        for (const item of selected)
            this.addChip(item, false);
        this._renderChips();
    }

    getData() {
        return this.selected;
    }

    addChip(item, focus = true) {
        if (!item || !item.id) return;
        if (this.selected.some((s) => s.id === item.id)) return;   // no duplicates
        this.selected.push({ id: item.id, text: item.text || String(item.id) });
        this._renderChips();
        this.input.value = '';
        this._closeDropdown();
        if (focus) this.input.focus();
    }

    deleteChip(id) {
        this.selected = this.selected.filter((s) => s.id !== id);
        this._renderChips();
    }

    _renderChips() {
        this.chipsEl.querySelectorAll('.chip').forEach((c) => c.remove());
        const frag = document.createDocumentFragment();
        for (const item of this.selected) {
            const chip = document.createElement('span');
            chip.className = 'chip';
            chip.appendChild(document.createTextNode(item.text));

            const close = document.createElement('button');
            close.type = 'button';
            close.className = 'material-icons close';
            close.textContent = 'close';
            close.addEventListener('click', () => {
                this.deleteChip(item.id);
                this.input.focus();
            });

            chip.appendChild(close);
            frag.appendChild(chip);
        }
        this.chipsEl.insertBefore(frag, this.input);   // chips render before the input
    }

    _bindEvents() {
        this.input.addEventListener('input', () => this._renderDropdown());
        this.input.addEventListener('focus', () => {
            this.chipsEl.classList.add('focus');
            this._renderDropdown();
        });
        this.input.addEventListener('blur', () => {
            this.chipsEl.classList.remove('focus');
            this._closeDropdown();
        });
        this.input.addEventListener('keydown', (e) => this._onKeydown(e));

        // Clicking empty space in the box focuses the input (Materialize behaviour).
        this.chipsEl.addEventListener('mousedown', (e) => {
            if (e.target === this.chipsEl) {
                e.preventDefault();
                this.input.focus();
            }
        });
    }

    _matches() {
        const q = this.input.value.trim().toLowerCase();
        if (q.length < this.minLength) return [];
        return this.source.filter((o) =>
            !this.selected.some((s) => s.id === o.id) &&
            o.text.toLowerCase().includes(q));
    }

    _renderDropdown() {
        const matches = this._matches();
        this.dropdown.replaceChildren();
        this.activeIndex = -1;
        if (matches.length === 0) {
            this._closeDropdown();
            return;
        }
        for (const m of matches) {
            const li = document.createElement('li');
            li.dataset.id = m.id;
            const itemText = document.createElement('div');
            itemText.className = 'item-text';
            itemText.textContent = m.text;
            li.appendChild(itemText);
            // mousedown (not click) so it fires before the input's blur, and
            // preventDefault keeps focus in the input for adding the next chip.
            li.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.addChip(m);
            });
            this.dropdown.appendChild(li);
        }
        this._positionDropdown();
        this.dropdown.style.display = 'block';
    }

    // Place the dropdown right under the chips box. When it lives in a separate
    // container (the dialog), position it fixed in viewport coordinates: fixed
    // escapes the dialog's overflow clipping so the list floats over the modal
    // (like every other dropdown here) instead of being cut at the dialog edge.
    // When nested in the chips box itself the CSS top:100% handles it.
    _positionDropdown() {
        if (this.dropdownContainer === this.chipsEl) return;
        const box = this.chipsEl.getBoundingClientRect();
        this.dropdown.style.top = box.bottom + 'px';
        this.dropdown.style.left = box.left + 'px';
        this.dropdown.style.width = box.width + 'px';
    }

    _closeDropdown() {
        this.dropdown.style.display = 'none';
        this.dropdown.replaceChildren();
        this.activeIndex = -1;
    }

    _onKeydown(e) {
        const items = Array.from(this.dropdown.children);
        const open = this.dropdown.style.display !== 'none' && items.length > 0;

        if (e.key === 'ArrowDown' && open) {
            e.preventDefault();
            this._setActive(Math.min(this.activeIndex + 1, items.length - 1));
        }
        else if (e.key === 'ArrowUp' && open) {
            e.preventDefault();
            this._setActive(Math.max(this.activeIndex - 1, 0));
        }
        else if (e.key === 'Enter' && open) {
            e.preventDefault();
            const idx = this.activeIndex >= 0 ? this.activeIndex : 0;
            const m = this.source.find((o) => o.id === items[idx].dataset.id);
            if (m) this.addChip(m);
        }
        else if (e.key === 'Backspace' && this.input.value === '' && this.selected.length) {
            this.deleteChip(this.selected[this.selected.length - 1].id);
        }
    }

    _setActive(i) {
        const items = Array.from(this.dropdown.children);
        items.forEach((li) => li.classList.remove('selected'));
        this.activeIndex = i;
        if (i >= 0 && items[i]) {
            items[i].classList.add('selected');
            items[i].scrollIntoView({ block: 'nearest' });
        }
    }
}
