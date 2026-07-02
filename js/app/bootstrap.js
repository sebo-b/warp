'use strict';

// Fetch/cache/refresh for /xhr/bootstrap ({plans, zones, defaultPlan, isAdmin,
// login, name}) — the moved headerDataInit query. One call at shell boot;
// refresh() is called by plan/zone CRUD flows (WP4+) so the nav and the prefs/
// calendar modal option lists stay in sync without a page reload.
let data = null;
let inflight = null;

export function get() {
  if (data) return Promise.resolve(data);
  if (inflight) return inflight;
  inflight = fetch(window.warpGlobals.URLs.bootstrap)
    .then(function (r) {
      if (!r.ok) throw new Error('Failed to load bootstrap: ' + r.status);
      return r.json();
    })
    .then(function (d) {
      data = d;
      inflight = null;
      return d;
    })
    .catch(function (err) {
      inflight = null;
      throw err;
    });
  return inflight;
}

export function refresh() {
  data = null;
  return get();
}

export function current() {
  return data;
}

export default { get, refresh, current };
