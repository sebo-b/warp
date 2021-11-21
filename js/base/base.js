'use strict';

import './style.css';
import Polyglot from 'node-polyglot';

if (typeof(window?.warpGlobals?.i18n) !== 'object')
  throw Error('warpGlobals.i18n must be defined');

let locale = window.warpGlobals.i18n.locale;
let phrases = window.warpGlobals.i18n.phrases;

if (!locale || !phrases)
  throw Error('locale and phrases must be defined');

window.warpGlobals.i18n.polyglot = new Polyglot({
  locale: locale,
  phrases: phrases
})

window.TR = window.warpGlobals.i18n.polyglot.t.bind(window.warpGlobals.i18n.polyglot);
window.TR.has = window.warpGlobals.i18n.polyglot.has.bind(window.warpGlobals.i18n.polyglot);

const trClass = 'TR';

window.TR.updateDOM = function() {
  //don't use getElementByClassName as it is a live collection
  for (let e of document.querySelectorAll("."+trClass)) {
    let key = e.textContent.replace(/^\s*|\s*$/g,'').replace(/\s*\n\s*/g,' ');
    e.textContent = window.warpGlobals.i18n.polyglot.t(key);
    e.classList.remove(trClass);
  }
}

window.TR.inline = function() {
  document.write(
    window.warpGlobals.i18n.polyglot.t.apply(
      window.warpGlobals.i18n.polyglot,
      arguments));
}

document.addEventListener("DOMContentLoaded", function(e) {
  window.TR.updateDOM();
});
