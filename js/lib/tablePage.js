'use strict';

import { TabulatorFull as Tabulator } from 'tabulator-tables';
import '../views/css/tabulator/tabulator.css';

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
  ajaxConfig: 'POST',
  ajaxContentType: 'json',
};

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

  return new Tabulator(selector, merged);
}

export default createTable;
