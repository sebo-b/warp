'use strict';

import Polyglot from 'node-polyglot';

// Async i18n load (fetch instead of the old sync XHR — a long-lived SPA can't
// afford a blocking request on the boot path). Resolves once window.TR is ready.
export function loadI18n() {
  if (!window?.warpGlobals?.i18nUrl)
    throw Error('warpGlobals.i18nUrl must be defined');

  return fetch(window.warpGlobals.i18nUrl)
    .then(function (r) {
      if (!r.ok) throw new Error('Failed to load i18n: ' + r.status);
      return r.json();
    })
    .then(function (i18n) {
      window.warpGlobals.i18n = i18n;

      let locale = i18n.locale;
      let phrases = i18n.phrases;
      let weekdaysShort = i18n.weekdaysShort;

      if (!locale || !phrases)
        throw Error('locale and phrases must be defined');

      window.warpGlobals.i18n.polyglot = new Polyglot({
        locale: locale,
        phrases: { ...phrases, weekdaysShort }
      });

      window.TR = window.warpGlobals.i18n.polyglot.t.bind(window.warpGlobals.i18n.polyglot);
      window.TR.has = window.warpGlobals.i18n.polyglot.has.bind(window.warpGlobals.i18n.polyglot);

      const trClass = 'TR';

      // Scoped to `root` (defaults to the whole document) so the router can
      // translate just the freshly-mounted view fragment (router.js step 3).
      window.TR.updateDOM = function (root) {
        for (let e of (root || document).querySelectorAll('.' + trClass)) {
          let key = e.textContent.replace(/^\s*|\s*$/g, '').replace(/\s*\n\s*/g, ' ');
          e.textContent = window.warpGlobals.i18n.polyglot.t(key);
          e.classList.remove(trClass);
        }
      };

      window.TR.inline = function () {
        document.write(
          window.warpGlobals.i18n.polyglot.t.apply(
            window.warpGlobals.i18n.polyglot,
            arguments));
      };

      return window.TR;
    });
}

export default loadI18n;
