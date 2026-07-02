'use strict';

// Ref-counted spinner, extracted from the old Utils.xhr so both XHR calls and
// route transitions can share one counter (a transition that also fires XHRs
// shouldn't flicker the spinner off between them).
let counter = 0;
let el = null;

function spinnerEl() {
  if (!el) el = document.getElementById('spinner');
  return el;
}

export function acquire() {
  if (counter++ === 0) spinnerEl().classList.add('active');
}

export function release() {
  if (counter > 0 && --counter === 0) spinnerEl().classList.remove('active');
}

export default { acquire, release };
