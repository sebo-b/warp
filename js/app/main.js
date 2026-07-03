'use strict';

// Boot sequence — see PLAN_SPA_REFACTOR.md §2.4.
// publicPath must be the very first import: it must run before any other
// module's side effects could trigger a dynamic chunk load.
import './publicPath.js';
import '../base/style.css';

import loadI18n from './i18n.js';
import * as bootstrap from './bootstrap.js';
import { M } from './materialize.js';
import './dialog.js';
import { initThemeToggle } from './theme.js';
import { initTriggerClasses } from './triggers.js';
import { initPrefs } from './modals/prefs.js';
import { initCalendar } from './modals/calendar.js';
import { initChangePassword } from './modals/changePassword.js';
import * as nav from './nav.js';
import router from './router.js';

// Materialize 2.x needs an explicit init call to wire up .dropdown-trigger
// elements (the user/admin menu icons) — there's no auto-init class scan.
function initDropdowns() {
  document.querySelectorAll('.dropdown-trigger').forEach(function (el) {
    M.Dropdown.init(el, { coverTrigger: false, constrainWidth: false });
  });
}

// Same 2.x gap for .collapsible: without an explicit init the mobile
// sidenav's accordion groups (Admin / <login>) render folded and never
// expand on click. The sidenav is static shell markup, so a one-shot boot
// init covers it (nav.js only inserts flat <li> links, no collapsibles).
function initSidenavCollapsibles() {
  document.querySelectorAll('.sidenav .collapsible').forEach(function (el) {
    M.Collapsible.init(el, { accordion: true });
  });
}

async function boot() {
  let pendingToast = window.sessionStorage.getItem('pendingToast');

  // DOM-only inits first (dropdowns, theme, triggers): they touch only shell
  // markup that's already in the DOM, so wiring them before the network awaits
  // closes the race where a shell .dropdown-trigger painted at first paint
  // was only wired after boot() resolved two fetches (e2e waited around it).
  initDropdowns();
  initSidenavCollapsibles();
  initThemeToggle();
  initTriggerClasses();

  // In parallel: i18n and the nav/prefs/plan bootstrap payload. Both are
  // awaited below — the calendar modal reads window.warpGlobals.i18n
  // synchronously at init, so TR must be ready before initCalendar().
  try {
    await Promise.all([loadI18n(), bootstrap.get()]);
  } catch (err) {
    // A transient 500 / DB hiccup / network failure on /xhr/bootstrap or the
    // i18n JSON at page load would otherwise reject boot() unhandled:
    // router.start() never runs, #view-root stays empty forever, no spinner,
    // no retry. Render the same "can't reach the server" view the router uses
    // for mid-session network failures, with a retry link. (A 401
    // SESSION_EXPIRED never reaches here — Utils.xhr redirects to login first.)
    // i18n may not be loaded yet, so use plain text instead of TR().
    var root = document.getElementById('view-root');
    if (root) {
      root.innerHTML =
        '<div id="view-error" class="view-error">' +
        "<h5>Can't reach the server.</h5>" +
        '<div class="view-error-actions" style="margin-top:16px">' +
        '<a href="' + window.location.pathname + window.location.search + '" class="btn warp-btn-primary">Retry</a>' +
        '</div></div>';
    }
    document.body.dataset.view = 'error';
    document.body.dataset.viewReady = '';
    return;
  }

  initPrefs();
  initCalendar();
  initChangePassword();

  window.TR.updateDOM();

  // Opt every WARP form field into Materialize 2.x's built-in `.outlined`
  // text-field variant (bordered box). Scoped to .warp-fields containers so
  // the nav search and the zone "book-for" underline field are left untouched;
  // chips are excluded (they are a multi-value container, not a text field).
  document.querySelectorAll('.warp-fields .input-field:not(.chips)').forEach(function (el) {
    el.classList.add('outlined');
  });
  M.updateTextFields(); // ensure placeholder=" " so 2.x CSS label-float works

  await nav.render();

  if (pendingToast) {
    window.sessionStorage.removeItem('pendingToast');
    M.toast({ text: pendingToast });
  }

  await router.start();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
