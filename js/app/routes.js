'use strict';

// Route registry: pattern -> { name, load }. Patterns use a plain `:param`
// segment syntax (no wildcards — the 10 SPA routes below are all the app has).
// Grows one entry per work package as each view is converted; a path that
// matches no entry renders the client #view-error "not found" state (router.js).
export const routes = [
  { name: 'index', pattern: '/', load: () => import(/* webpackChunkName: "view-index" */ '../views/index.js') },
  { name: 'users', pattern: '/users', load: () => import(/* webpackChunkName: "view-users" */ '../views/users.js') },
  { name: 'groups', pattern: '/groups', load: () => import(/* webpackChunkName: "view-groups" */ '../views/groups.js') },
  { name: 'zones', pattern: '/zones', load: () => import(/* webpackChunkName: "view-zones" */ '../views/zones.js') },
  { name: 'plans', pattern: '/plans', load: () => import(/* webpackChunkName: "view-plans" */ '../views/plans.js') },
];

function segs(path) {
  return path.split('/').filter(Boolean);
}

export function matchRoute(pathname) {
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

export default { routes, matchRoute };
