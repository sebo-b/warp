'use strict';

// Route registry: pattern -> { name, load }. Patterns use a plain `:param`
// segment syntax (no wildcards — the 10 SPA routes below are all the app has).
// Grows one entry per work package as each view is converted; a path that
// matches no entry renders the client #view-error "not found" state (router.js).

// Mount-prefix support: spaURLs() is url_for-based (prefix-aware), so XHR
// URLs already work under a reverse-proxy mount (e.g. /warp). But the router
// matches location.pathname and views navigate() with route-relative paths
// ('/plan/1'), which both need the base path stripped/prepended to resolve
// under a mount. Derive it once from warpGlobals.URLs.users (url_for('view.users')
// -> '/warp/users' under a mount, '/users' at root) by removing the known
// '/users' suffix — the single source of truth stays spaURLs(), not a JS copy.
function deriveBasePath() {
  var u = (window.warpGlobals && window.warpGlobals.URLs && window.warpGlobals.URLs.users) || '/users';
  try {
    var p = new URL(u, window.location.origin).pathname;
  } catch (e) {
    return '';
  }
  var suffix = '/users';
  return p.endsWith(suffix) ? p.slice(0, p.length - suffix.length) : '';
}
export const basePath = deriveBasePath();

export const routes = [
  { name: 'index', pattern: '/', load: () => import(/* webpackChunkName: "view-index" */ '../views/index.js') },
  { name: 'users', pattern: '/users', load: () => import(/* webpackChunkName: "view-users" */ '../views/users.js') },
  { name: 'groups', pattern: '/groups', load: () => import(/* webpackChunkName: "view-groups" */ '../views/groups.js') },
  { name: 'zones', pattern: '/zones', load: () => import(/* webpackChunkName: "view-zones" */ '../views/zones.js') },
  { name: 'plans', pattern: '/plans', load: () => import(/* webpackChunkName: "view-plans" */ '../views/plans.js') },
  { name: 'groupAssign', pattern: '/groups/assign/:group_login', load: () => import(/* webpackChunkName: "view-groupAssign" */ '../views/groupAssign.js') },
  { name: 'zoneAssign', pattern: '/zones/assign/:zid', load: () => import(/* webpackChunkName: "view-zoneAssign" */ '../views/zoneAssign.js') },
  // /bookings and /bookings/report share one module (views/bookings.js);
  // meta.report tells mount() which mode to render — see PLAN_SPA_REFACTOR.md §2.4.
  { name: 'bookings', pattern: '/bookings', meta: {report: false}, load: () => import(/* webpackChunkName: "view-bookings" */ '../views/bookings.js') },
  { name: 'bookingsReport', pattern: '/bookings/report', meta: {report: true}, load: () => import(/* webpackChunkName: "view-bookings" */ '../views/bookings.js') },
  { name: 'plan', pattern: '/plan/:pid', load: () => import(/* webpackChunkName: "view-plan" */ '../views/plan.js') },
  { name: 'planModify', pattern: '/plans/modify/:pid', load: () => import(/* webpackChunkName: "view-planModify" */ '../views/planModify.js') },
];

function segs(path) {
  return path.split('/').filter(Boolean);
}

export function matchRoute(pathname) {
  // Strip the mount prefix so route patterns (which are prefix-relative) match
  // under a reverse-proxy mount. Bare '/' stays '/' (not '').
  if (basePath && pathname.indexOf(basePath) === 0) pathname = pathname.slice(basePath.length);
  if (pathname === '') pathname = '/';
  var pathSegs = segs(pathname);
  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    var patSegs = segs(route.pattern);
    if (patSegs.length !== pathSegs.length) continue;
    var params = {};
    var ok = true;
    for (var j = 0; j < patSegs.length; j++) {
      var p = patSegs[j];
      if (p.charAt(0) === ':') {
        params[p.slice(1)] = decodeURIComponent(pathSegs[j]);
      } else if (p !== pathSegs[j]) {
        ok = false;
        break;
      }
    }
    if (ok) return { route: route, params: params };
  }
  return null;
}

export default { routes, matchRoute, basePath, safeReturn };

// Sanitize a caller-supplied `?return=` value before writing it into a link
// href: a crafted `?return=javascript:alert(document.cookie)` would execute on
// click (the router's link interception only intercepts registered routes, so
// a javascript:/foreign-origin href falls through to the browser), and a
// foreign https URL is an open redirect. Accept only same-origin http(s)
// paths that resolve to a registered SPA route; otherwise fall back to a
// trusted (spaURLs-derived) URL.
export function safeReturn(raw, fallbackUrl) {
  if (!raw) return fallbackUrl;
  try {
    var u = new URL(raw, window.location.origin);
  } catch (e) {
    return fallbackUrl;
  }
  if (u.origin !== window.location.origin) return fallbackUrl;
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return fallbackUrl;
  if (!matchRoute(u.pathname)) return fallbackUrl;
  return raw;
}
