'use strict';

// Fetch-once cache, generalizing the 4 duplicated patterns (user groups,
// timezones, zone groups/names): the first get() call runs `fetcher()` and
// caches the resulting promise; later calls reuse it. invalidate() clears the
// cache so the next get() re-fetches — call it from CRUD mutations that
// change the cached set (no page reloads to clear it anymore in the SPA).
// A rejected fetch clears itself so the next get() retries instead of
// replaying the same failure forever.
export function lazyCache(fetcher) {
  var promise = null;
  return {
    get: function () {
      if (!promise) {
        promise = fetcher().catch(function (err) {
          promise = null;
          throw err;
        });
      }
      return promise;
    },
    invalidate: function () {
      promise = null;
    }
  };
}

export default lazyCache;
