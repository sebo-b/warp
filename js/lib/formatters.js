'use strict';

// Shared Tabulator cell formatters — replaces the 15+ near-identical
// icon/userType/zoneRole/chip/timestamp formatters duplicated across
// zones/plans/bookings/assigns/users.

export function iconFormatter(defaults) {
  var d = defaults || {};
  return function (cell, formatterParams) {
    var p = Object.assign({}, d, formatterParams);
    var icon = p.icon || 'warning';
    var colorClass = p.colorClass || '';
    var iconClass = p.iconClass || 'material-icons-outlined';
    return '<i class="' + iconClass + ' ' + colorClass + '">' + icon + '</i>';
  };
}

// labels: [{value, label}, ...] with a first {label} entry (no value) used as
// the "unknown value" fallback — matches the accountTypes/zoneRoles/zoneType
// label arrays' own {label:"---"} convention.
export function labelFormatter(labels) {
  return function (cell) {
    var value = cell.getValue();
    for (var i = 0; i < labels.length; i++) {
      if (labels[i].value == value) return labels[i].label;
    }
    return labels[0].label;
  };
}

export function userTypeFormatter(cell) {
  var isGroup = cell.getRow().getData()['isGroup'];
  return '<i class="material-icons">' + (isGroup ? 'group' : 'person') + '</i>';
}

// A login/name cell that's a plain link (to urlKey, with __LOGIN__ replaced)
// when the row is a group, or plain text for a user.
export function userGroupLinkFormatter(urlKey) {
  return function (cell) {
    var data = cell.getData();
    if (!data.isGroup) return cell.getValue();
    var url = window.warpGlobals.URLs[urlKey].replace('__LOGIN__', data.login);
    return '<a href="' + url + '" class="userGroupCell">' + cell.getValue() + '</a>';
  };
}

export function chipListFormatter(cell) {
  var values = cell.getValue();
  if (!values || !values.length) return '<span class="grey-text">—</span>';
  return values.map(function (v) {
    return '<div class="chip" style="margin:1px 2px">' + v + '</div>';
  }).join('');
}

export function timestampFormatter(cell) {
  var ts = new Date(parseInt(cell.getValue()) * 1000);
  return ts.toISOString().substring(0, 16).replace('T', ' ');
}

export default {
  iconFormatter,
  labelFormatter,
  userTypeFormatter,
  userGroupLinkFormatter,
  chipListFormatter,
  timestampFormatter,
};
