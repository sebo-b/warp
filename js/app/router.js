'use strict';

// Hand-rolled History-API router. Handles view transitions (spinner, unmount/
// mount lifecycle, error views), same-origin link interception, and popstate.
// See PLAN_SPA_REFACTOR.md §2.2 for the transition-order contract each view
// module must honor: default-export { html, async mount(ctx) -> unmount }.

import spinner from './spinner.js';
import { M } from './materialize.js';
import { matchRoute, basePath } from './routes.js';
import * as nav from './nav.js';

let currentUnmount = null;
let currentController = null;
let transitionSeq = 0;

// In-SPA leave guard: a view with unsaved state (currently the plan editor)
// registers a function returning Promise<boolean>. navigate()/popstate await
// it before changing the view; false = the user chose to stay, so the route
// change is aborted. beforeunload already covers real tab unloads; this covers
// client-side route changes (nav links, back/forward) that never fire it.
// Single slot — the mounted view owns it and clears it on unmount.
let leaveGuard = null;
let currentPath = window.location.pathname + window.location.search;

export function setLeaveGuard(fn) { leaveGuard = fn; }
export function clearLeaveGuard() { leaveGuard = null; }

function mayLeave() {
  if (!leaveGuard) return Promise.resolve(true);
  return Promise.resolve(leaveGuard()).then(function (ok) { return !!ok; });
}

function renderErrorView(root, kind) {
  var title, action = '';
  if (kind === 'network') {
    // Server unreachable mid-session (a context/bootstrap XHR failed at the
    // network layer, not an HTTP error). Don't call it "not found" — offer a
    // retry that re-runs this transition once the server is back.
    title = "Can't reach the server.";
    action = '<a href="' + window.location.pathname + window.location.search +
             '" class="btn warp-btn-primary TR">Retry</a>';
  } else if (kind === 'forbidden') {
    title = 'You do not have access to this page.';
  } else if (kind === 'server') {
    title = 'Something went wrong.';
  } else { // 'notfound'
    title = 'Page not found.';
  }
  root.innerHTML =
    '<div id="view-error" class="view-error">' +
    '<h5 class="TR">' + title + '</h5>' +
    (action ? '<div class="view-error-actions" style="margin-top:16px">' + action + '</div>' : '') +
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
    // Null the handle BEFORE awaiting it: two rapid navigations could both
    // observe a non-null currentUnmount and double-invoke the same unmount
    // (double table.destroy()/om.destroy()/BookFor.reset()), where the second
    // throw is swallowed by the catch below and any teardown after it is
    // silently skipped (leaked observers/sliders across the navigation).
    var prevUnmount = currentUnmount;
    currentUnmount = null;
    if (typeof prevUnmount === 'function') {
      try { await prevUnmount(); } catch (e) { /* a broken unmount must not wedge navigation */ }
    }
    if (currentController) currentController.abort();
    currentController = null;
    if (seq !== transitionSeq) return; // superseded by a newer navigation
    root.replaceChildren();

    var match;
    try {
      match = matchRoute(pathname);
    } catch (e) {
      // decodeURIComponent throws URIError on a malformed %-encoded path —
      // treat it as not-found rather than crashing the transition.
      match = null;
    }

    if (!match) {
      renderErrorView(root, 'notfound');
      document.body.dataset.view = 'error';
    } else {
      // 3. Dynamic-import the view chunk, mount its markup, translate, mount().
      // The chunk load and the mount share one catch: a rejected import()
      // (redeploy swapped content-hashed chunks mid-session, or a transient
      // network failure) is a "can't reach the server" condition, not a
      // 404 — and it must not leave a blank #view-root after replaceChildren()
      // already cleared the previous view.
      var view;
      try {
        view = await match.route.load();
      } catch (loadErr) {
        if (seq !== transitionSeq) return;
        renderErrorView(root, 'network');
        document.body.dataset.view = 'error';
        return;
      }
      if (seq !== transitionSeq) return;

      root.innerHTML = view.html || '';
      if (window.TR) window.TR.updateDOM(root);
      // Apply the same .outlined text-field variant + placeholder=" " seeding
      // the shell got at boot (main.js) — but the boot scan ran before this
      // view fragment was in the DOM, so without re-applying it here every
      // view-mounted input/select would render in Materialize's default
      // (filled) style with broken label-float. Idempotent: already-outlined /
      // already-placeholdered elements are skipped.
      root.querySelectorAll('.warp-fields .input-field:not(.chips)').forEach(function (el) {
        el.classList.add('outlined');
      });
      M.updateTextFields();

      var controller = new AbortController();
      currentController = controller;

      var ctx = {
        root: root,
        params: match.params,
        query: parseQuery(search),
        navigate: navigate,
        signal: controller.signal,
        // route.name/meta let two patterns share one view module (e.g.
        // /bookings and /bookings/report both load views/bookings.js, which
        // reads ctx.meta.report to pick its mode).
        route: match.route.name,
        meta: match.route.meta || {}
      };

      try {
        var unmount = await view.mount(ctx);
        if (seq !== transitionSeq) {
          // Superseded while mount() was in flight (e.g. plan A -> B -> C with
          // a slow getContext): the just-returned unmount is NOT assigned to
          // currentUnmount (the seq check below would skip it), so without
          // invoking it here B's OfficeMap listeners/theme observer leak
          // permanently and its PlanUserData/BookFor singletons stay init'd,
          // then C's mount throws "already initialized" -> "Page not found".
          // Tear B down now so C mounts clean.
          currentController = null;
          if (typeof unmount === 'function') {
            try { await unmount(); } catch (e) { /* best-effort teardown */ }
          }
          return;
        }
        currentUnmount = typeof unmount === 'function' ? unmount : null;
        document.body.dataset.view = match.route.name;
      } catch (err) {
        // 5. mount() rejected — map the rejection to the right client error
        // view (the SPA's replacement for the old server-side 403/404 on deep
        // links). A network failure (server down mid-session) is its own case,
        // distinct from a 403/404 HTTP response.
        if (seq !== transitionSeq) return;
        root.replaceChildren();
        var kind;
        if (err && err.network) kind = 'network';
        else if (err && err.status === 403) kind = 'forbidden';
        else if (err && err.status === 404) kind = 'notfound';
        else if (err && err.status === 500) kind = 'server';
        else kind = 'notfound';
        renderErrorView(root, kind);
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

export async function navigate(path, opts) {
  opts = opts || {};
  var url = new URL(path, window.location.origin);
  // Views call navigate() with route-relative paths ('/plan/1'), while link
  // interception passes already-prefixed pathnames (a.pathname under a mount
  // includes the prefix). Prepend the base path only when the path isn't
  // already under it, so both forms resolve correctly under a reverse-proxy
  // mount and are a no-op at root (basePath === '').
  if (basePath && url.pathname.indexOf(basePath + '/') === 0) {
    // already prefixed (link interception) — leave as-is
  } else if (basePath && url.pathname !== basePath) {
    url.pathname = basePath + url.pathname;
  }
  // Guard BEFORE touching history: if the current view is dirty and the user
  // declines to leave, abort with no URL/view change. A no-op for routes that
  // never register a guard.
  if (!await mayLeave()) return false;
  if (opts.replace) {
    window.history.replaceState(null, '', url);
  } else {
    window.history.pushState(null, '', url);
  }
  currentPath = url.pathname + url.search;
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
    // Hash-only hrefs are never routes. Action buttons were migrated to real
    // <button type="button"> elements; what's left on '#'/'#!' is Materialize's
    // own nav idiom (dropdown-/sidenav-triggers, .modal-trigger targets —
    // triggers.js owns those). Still suppress the bare '#'/'#!' default so no
    // affordance can rewrite the URL to /users#! and fire popstate (which used
    // to remount the whole view mid-save — see the popstate guard in start()).
    if (!hrefAttr || hrefAttr.charAt(0) === '#') {
      if (hrefAttr === '#' || hrefAttr === '#!') ev.preventDefault();
      return;
    }
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
  currentPath = window.location.pathname + window.location.search;
  window.addEventListener('popstate', async function () {
    var toPath = window.location.pathname + window.location.search;
    // Same-document fragment navigations (clicking any legacy '#'/'#!'-href
    // affordance, in-page anchors, or back/forward between hash states) fire
    // popstate too. The route (pathname+search) didn't change, so remounting
    // would destroy and recreate the view — racing whatever XHR the view just
    // fired (an edit-dialog save) against the remount's fresh table load, and
    // leaving the visible table stale when the list read beat the commit.
    if (toPath === currentPath) return;
    if (!await mayLeave()) {
      // The browser already moved the URL; the user chose to stay, so undo
      // by pushing the previous path back. Adds one history entry (the usual
      // SPA-guard imperfection) but keeps the user on the dirty view.
      window.history.pushState(null, '', currentPath);
      return;
    }
    currentPath = toPath;
    transition(window.location.pathname, window.location.search);
  });
  return transition(window.location.pathname, window.location.search);
}

export default { start, navigate, transition, setLeaveGuard, clearLeaveGuard };
