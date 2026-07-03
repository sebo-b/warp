'use strict';

import { TabulatorFull as Tabulator } from 'tabulator-tables';
import '../views/css/tabulator/tabulator.css';
import Utils from '../views/modules/utils.js';

// WARP's standard Tabulator options — height/layout/resizable defaults, i18n
// langs, and (unless remote:false) the remote pagination/sort/filter/ajax
// wiring every admin table repeats. Replaces the 9 near-identical Tabulator
// setups across users/groups/zones/plans/bookings/groupAssign/zoneAssign.
//
// Doesn't register a destroy hook itself: call `.destroy()` on the returned
// instance from the view's unmount() (router.js recreates #view-root per
// mount, so a leaked Tabulator instance would otherwise keep its ajax/DOM
// listeners alive after the view is gone).
const DEFAULTS = {
  height: '3000px',   // limited by maxHeight — Tabulator needs an explicit height for paginationSize to work correctly
  maxHeight: '100%',
  layout: 'fitDataFill',
  columnDefaults: { resizable: true },
};

const REMOTE_DEFAULTS = {
  pagination: true,
  paginationMode: 'remote',
  sortMode: 'remote',
  filterMode: 'remote',
  // Route every table request through Utils.xhr instead of Tabulator's
  // built-in fetcher: that way table load/pagination/sort/filter get the SAME
  // 401 session-expiry redirect, network-down handling, and ref-counted
  // spinner as every other XHR (the built-in fetcher bypassed all three, so a
  // session expiring on a table view left a silently dead table). The func
  // receives Tabulator's compiled params (page/size/sorters/filters/ajaxParams)
  // and returns the parsed JSON body ({data, last_page}) Tabulator expects.
  ajaxRequestFunc: function (url, config, params) {
    return Utils.xhr.post(url, params, { toastOnSuccess: false, errorOnFailure: false })
      .then(function (result) { return result.response; });
  }
};

// Toggle a .warp-loading class on the table root around its ajax so an
// in-table spinner overlay shows during pagination/sort/filter. Tabulator 6's
// built-in dataLoader alert only fires for NON-silent loads, and remote
// sort/filter go through the silent path, so the stock loader never appears
// for them — drive it ourselves from the ajax lifecycle instead.
//
// ajaxRequesting/ajaxResponse are OPTIONS (not events) because the initial
// load starts inside the Tabulator constructor, before any table.on() listener
// could be attached — setting them as options guarantees the first request is
// covered too. dataLoadError (a post-construction event) clears on failure, and
// tableDestroyed clears a stuck class if the view unmounts mid-request.
function withLoadingOverlay(merged) {
  merged.ajaxRequesting = function () { this.element.classList.add('warp-loading'); };
  merged.ajaxResponse = function (url, params, data) {
    this.element.classList.remove('warp-loading');
    return data;   // ajaxResponse is also a response transform — pass through
  };
}

export function createTable(selector, options) {
  var opts = Object.assign({}, options);
  var remote = opts.remote !== false;
  delete opts.remote;

  var merged = Object.assign(
    {},
    DEFAULTS,
    remote ? REMOTE_DEFAULTS : {},
    { langs: window.warpGlobals.i18n.tabulatorLangs },
    opts
  );

  if (remote) withLoadingOverlay(merged);

  var table = new Tabulator(selector, merged);

  if (remote) {
    // ajaxResponse doesn't fire on failure (the request promise rejects), so
    // clear on dataLoadError. tableDestroyed guards a request still in flight
    // when the view unmounts and calls table.destroy().
    var clear = function () { table.element.classList.remove('warp-loading'); };
    table.on('dataLoadError', clear);
    table.on('tableDestroyed', clear);

    // Expose the initial ajax as a promise so a table-first view (one whose
    // mount() creates the table and returns without awaiting any XHR) can
    // `await table.initialLoad` in mount(). A network failure on the first
    // load then rejects mount() and the router renders the full-page "server
    // down" view — without this, the table's inline Tabulator alert is the
    // only feedback (the router never sees the failure, since mount() already
    // resolved). One-shot: settles on the first dataLoaded/dataLoadError only.
    var settled = false;
    table.initialLoad = new Promise(function (resolve, reject) {
      table.on('dataLoaded', function () { if (!settled) { settled = true; resolve(); } });
      table.on('dataLoadError', function (err) { if (!settled) { settled = true; reject(err); } });
    });
  }

  return table;
}

export default createTable;