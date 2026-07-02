'use strict';

// Fetch/cache/refresh for /xhr/bootstrap ({plans, zones, defaultPlan, isAdmin,
// login, name}) — the moved headerDataInit query. One call at shell boot;
// refresh() is called by plan/zone CRUD flows (WP4+) so the nav and the prefs/
// calendar modal option lists stay in sync without a page reload.
//
// Built on lazyCache + Utils.xhr (not raw fetch) so it shares the 401
// session-expiry redirect and the ref-counted spinner with every other XHR,
// and so a rejected load clears itself (the next get() retries instead of
// replaying the same failure forever). A refresh() while a get() is in flight
// invalidates the cache and re-fetches rather than returning the stale
// in-flight promise.

import { lazyCache } from '../lib/lazyCache.js';
import Utils from '../views/modules/utils.js';

const cache = lazyCache(function () {
  return Utils.xhr.get(window.warpGlobals.URLs.bootstrap, { toastOnSuccess: false, errorOnFailure: false })
    .then(function (result) { return result.response; });
});

export function get() {
  return cache.get();
}

export function refresh() {
  cache.invalidate();
  return cache.get();
}

export default { get, refresh };