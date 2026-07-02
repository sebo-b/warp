'use strict';

// Hand-rolled History-API router. Handles view transitions (spinner, unmount/
// mount lifecycle, error views), same-origin link interception, and popstate.
// See PLAN_SPA_REFACTOR.md §2.2 for the transition-order contract each view
// module must honor: default-export { html, async mount(ctx) -> unmount }.

import spinner from './spinner.js';
import { matchRoute } from './routes.js';
import * as nav from './nav.js';

let currentUnmount = null;
let currentController = null;
let transitionSeq = 0;

function renderErrorView(root, status) {
  root.innerHTML =
    '<div id="view-error" class="view-error">' +
    '<h5 class="TR">' + (status === 403 ? 'You do not have access to this page.' : 'Page not found.') + '</h5>' +
    '</div>';
  if (window.TR) window.TR.updateDOM(root);
}

function parseQuery(search) {
  var query = {};
  new URLSearchParams(search).forEach(function (v, k) { query[k] = v; });
  return query;
}

export async function transition(pathname, search) {
  var seq = ++transitionSeq;
  var root = document.getElementById('view-root');

  spinner.acquire();
  delete document.body.dataset.viewReady;

  try {
    // 2. Await the previous view's unmount, then clear the mount point.
    if (typeof currentUnmount === 'function') {
      try { await currentUnmount(); } catch (e) { /* a broken unmount must not wedge navigation */ }
    }
    if (currentController) currentController.abort();
    currentUnmount = null;
    currentController = null;
    if (seq !== transitionSeq) return; // superseded by a newer navigation
    root.replaceChildren();

    var match = matchRoute(pathname);

    if (!match) {
      renderErrorView(root, 404);
      document.body.dataset.view = 'error';
    } else {
      // 3. Dynamic-import the view chunk, mount its markup, translate, mount().
      var view = await match.route.load();
      if (seq !== transitionSeq) return;

      root.innerHTML = view.html || '';
      if (window.TR) window.TR.updateDOM(root);

      var controller = new AbortController();
      currentController = controller;

      var ctx = {
        root: root,
        params: match.params,
        query: parseQuery(search),
        navigate: navigate,
        signal: controller.signal
      };

      try {
        var unmount = await view.mount(ctx);
        if (seq !== transitionSeq) return;
        currentUnmount = typeof unmount === 'function' ? unmount : null;
        document.body.dataset.view = match.route.name;
      } catch (err) {
        // 5. mount() rejected (e.g. a 403/404 context XHR) -> client error view,
        // the SPA's replacement for the old server-side 403/404 on deep links.
        if (seq !== transitionSeq) return;
        root.replaceChildren();
        renderErrorView(root, err && err.status === 403 ? 403 : 404);
        document.body.dataset.view = 'error';
      }
    }
  } finally {
    // acquire()/release() must stay balanced per transition() call regardless
    // of staleness (a mount() that calls ctx.navigate() without awaiting it —
    // e.g. the index -> default-plan redirect — starts a nested transition
    // before this one settles; both hold a spinner claim and must each release
    // exactly once, or the spinner gets stuck on). Only the dataset/event side
    // effects that describe "which view is showing" are guarded by seq, so a
    // superseded transition doesn't stomp the newer one's result.
    spinner.release();
    if (seq === transitionSeq) {
      document.body.dataset.viewReady = '';
      nav.setActive();
      document.dispatchEvent(new CustomEvent('warp:view-ready', { detail: { view: document.body.dataset.view } }));
    }
  }
}

export function navigate(path, opts) {
  opts = opts || {};
  var url = new URL(path, window.location.origin);
  if (opts.replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
  return transition(url.pathname, url.search);
}

function isPlainLeftClick(ev) {
  return !ev.defaultPrevented && ev.button === 0 &&
    !ev.metaKey && !ev.ctrlKey && !ev.shiftKey && !ev.altKey;
}

function initLinkInterception() {
  document.addEventListener('click', function (ev) {
    if (!isPlainLeftClick(ev)) return;
    var a = ev.target.closest && ev.target.closest('a[href]');
    if (!a) return;

    var hrefAttr = a.getAttribute('href');
    // Hash-only hrefs are modal triggers / dropdown/collapsible affordances
    // (triggers.js owns those) — never routes.
    if (!hrefAttr || hrefAttr.charAt(0) === '#') return;
    if (a.target && a.target !== '' && a.target !== '_self') return;
    if (a.hasAttribute('download')) return;
    if (a.origin !== window.location.origin) return;
    // Only intercept paths that resolve to a registered SPA route; everything
    // else (server-rendered routes like /logout, /plan/image/<pid>, login,
    // mailto:, …) falls through to a normal full-page navigation.
    if (!matchRoute(a.pathname)) return;

    ev.preventDefault();
    navigate(a.pathname + a.search);
  });
}

export function start() {
  initLinkInterception();
  window.addEventListener('popstate', function () {
    transition(window.location.pathname, window.location.search);
  });
  return transition(window.location.pathname, window.location.search);
}

export default { start, navigate, transition };
