'use strict';

// Ref-counted spinner, extracted from the old Utils.xhr so both XHR calls and
// route transitions can share one counter (a transition that also fires XHRs
// shouldn't flicker the spinner off between them).
//
// Delayed show: only reveal the overlay after SPINNER_DELAY ms of continuous
// activity. Fast loads (a click that resolves in <150ms) never paint the
// opaque surface overlay, so a quick navigation no longer flashes the whole
// content area white and feels like a full reload. The counter is what tracks
// "busy"; the timer only gates the *visibility* of the already-busy state.
let counter = 0;
let el = null;
let showTimer = null;

const SPINNER_DELAY = 150;

function spinnerEl() {
  if (!el) el = document.getElementById('spinner');
  return el;
}

export function acquire() {
  if (counter++ === 0) {
    // Schedule the reveal; if release() drops to 0 before it fires, the timer
    // is cancelled and the overlay is never shown (the load was fast enough).
    showTimer = setTimeout(function () {
      showTimer = null;
      spinnerEl().classList.add('active');
    }, SPINNER_DELAY);
  }
}

export function release() {
  if (counter > 0 && --counter === 0) {
    if (showTimer !== null) {
      clearTimeout(showTimer);
      showTimer = null;
    } else {
      spinnerEl().classList.remove('active');
    }
  }
}

export default { acquire, release };
