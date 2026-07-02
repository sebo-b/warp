'use strict';

import { M } from '../materialize.js';
import warpDialog from '../dialog.js';
import noUiSlider from 'nouislider';
import * as bootstrap from '../bootstrap.js';
import { initFormSelect } from '../../lib/formSelect.js';
import Utils from '../../views/modules/utils.js';

function formatHHMM(seconds) {
  if (seconds >= 24 * 3600) return "23:59";
  return new Date(seconds * 1000).toISOString().substring(11, 16);
}

export function initPrefs() {
  var prefModalEl = document.getElementById('pref_modal');
  var planSelectEl = document.getElementById('pref_default_plan');
  var daySelectEl = document.getElementById('pref_default_day');
  var saveBtn = document.getElementById('pref_save_btn');
  var sliderEl = document.getElementById('pref_timeslider');
  var minDiv = document.getElementById('pref_timeslider-min');
  var maxDiv = document.getElementById('pref_timeslider-max');
  var showSeatNamesEl = document.getElementById('pref_zone_show_seat_names');
  var showBookingPreviewEl = document.getElementById('pref_zone_show_booking_preview');
  var showAssignedNamesEl = document.getElementById('pref_zone_show_assigned_names');

  if (!prefModalEl || !planSelectEl || !daySelectEl || !saveBtn || !sliderEl)
    return;

  // Render the FormSelect dropdowns into the dialog (not the scrolling
  // .modal-content), so a long list isn't clipped by the modal's overflow.
  var SELECT_OPTS = { dropdownOptions: { container: prefModalEl } };

  var DEFAULT_TIME = [9 * 3600, 17 * 3600];
  var loadedPrefs = null;
  var slider = null;

  // The <option> list used to be Jinja-rendered server-side from
  // accessiblePlans; now populated client-side from /xhr/bootstrap on open.
  function populatePlanOptions(data) {
    var current = planSelectEl.value;
    planSelectEl.innerHTML = '<option value="">--</option>';
    (data.plans || []).forEach(function (p) {
      var opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.name;
      planSelectEl.appendChild(opt);
    });
    planSelectEl.value = current;
  }

  function applyPrefsToUI() {
    var time = (loadedPrefs && loadedPrefs.default_time) ? loadedPrefs.default_time : DEFAULT_TIME;
    planSelectEl.value = (loadedPrefs && loadedPrefs.default_plan) ? String(loadedPrefs.default_plan) : "";
    daySelectEl.value = (loadedPrefs && loadedPrefs.default_day) ? loadedPrefs.default_day : "same";
    // Route through initFormSelect (destroy-then-init) instead of raw
    // M.FormSelect.init: applyPrefsToUI runs on every prefs load AND every
    // Save, so re-init without destroy stacked another .select-wrapper on each
    // call (duplicated "Default plan" / "Default day" dropdown triggers).
    initFormSelect(planSelectEl, SELECT_OPTS);
    initFormSelect(daySelectEl, SELECT_OPTS);
    if (slider) slider.set(time);
    if (showSeatNamesEl) showSeatNamesEl.checked = loadedPrefs ? loadedPrefs.zone_show_seat_names : false;
    if (showBookingPreviewEl) showBookingPreviewEl.checked = loadedPrefs ? loadedPrefs.zone_show_booking_preview : false;
    if (showAssignedNamesEl) showAssignedNamesEl.checked = loadedPrefs ? loadedPrefs.zone_show_assigned_names : false;
  }

  function ensureSlider() {
    var time = (loadedPrefs && loadedPrefs.default_time) ? loadedPrefs.default_time : DEFAULT_TIME;

    if (!slider) {
      noUiSlider.create(sliderEl, {
        start: time,
        connect: true,
        behaviour: 'drag',
        step: 15 * 60,
        margin: 15 * 60,
        orientation: 'horizontal',
        range: { min: +sliderEl.dataset.min, max: +sliderEl.dataset.max }
      });

      slider = sliderEl.noUiSlider;
      slider.on('update', function (values, handle, unencoded) {
        minDiv.innerText = formatHHMM(unencoded[0]);
        maxDiv.innerText = formatHHMM(unencoded[1]);
      });
      // User drag (not the programmatic .set on load) marks the modal dirty, so
      // an accidental Esc/outside-click won't silently discard the change.
      slider.on('slide', function () {
        warpDialog.getInstance(prefModalEl)?.markDirty();
      });
    }

    applyPrefsToUI();
  }

  initFormSelect(planSelectEl, SELECT_OPTS);
  initFormSelect(daySelectEl, SELECT_OPTS);

  warpDialog(prefModalEl, {
    onOpenStart: function () {
      ensureSlider();
      bootstrap.get().then(function (data) {
        populatePlanOptions(data);
        initFormSelect(planSelectEl, SELECT_OPTS);
      });
    }
  });

  // Via Utils.xhr (not raw fetch) so a session expiring on the prefs load
  // triggers the shared 401->login redirect and the ref-counted spinner, and so
  // the URL carries any reverse-proxy mount prefix (warpGlobals.URLs.prefs is
  // url_for-based). errorOnFailure:false: a benign load failure is swallowed
  // (the modal still opens with defaults) — the 401 redirect fires regardless,
  // before this catch.
  Utils.xhr.get(window.warpGlobals.URLs['prefs'], { toastOnSuccess: false, errorOnFailure: false })
    .then(function (result) {
      loadedPrefs = result.response;
      applyPrefsToUI();
    })
    .catch(function () {});

  function postPrefs(extraPayload, callback) {
    if (!slider) return;
    var payload = {
      default_plan: planSelectEl.value || undefined,
      default_day: daySelectEl.value,
      default_time: slider.get(true).map(function (v) { return Math.round(v); }),
      zone_show_seat_names: showSeatNamesEl ? showSeatNamesEl.checked : false,
      zone_show_booking_preview: showBookingPreviewEl ? showBookingPreviewEl.checked : false,
      zone_show_assigned_names: showAssignedNamesEl ? showAssignedNamesEl.checked : false
    };
    if (extraPayload) Object.assign(payload, extraPayload);

    // Utils.xhr (not raw fetch): shares the 401 redirect + spinner and stays
    // mount-prefix-correct. The caller's `callback(err)` still drives the
    // success/error toast, so errorOnFailure:false suppresses the duplicate
    // generic Utils error modal.
    Utils.xhr.post(window.warpGlobals.URLs['prefs'], payload, { toastOnSuccess: false, errorOnFailure: false })
      .then(function (result) {
        var prefs = result.response;
        loadedPrefs = prefs;
        applyPrefsToUI();
        window.warpGlobals = window.warpGlobals || {};
        window.warpGlobals['planPreviewPrefs'] = {
          show_seat_names: prefs.zone_show_seat_names,
          show_booking_preview: prefs.zone_show_booking_preview,
          show_assigned_names: prefs.zone_show_assigned_names
        };
        document.dispatchEvent(new CustomEvent('warp:prefsSaved', {
          detail: { planPreviewPrefs: window.warpGlobals['planPreviewPrefs'] }
        }));
        if (callback) callback(null, prefs);
      })
      .catch(function (err) {
        if (callback) callback(err);
      });
  }

  saveBtn.addEventListener('click', function () {
    postPrefs(null, function (err) {
      if (err) {
        M.toast({ text: TR('Error saving preferences') });
      } else {
        M.toast({ text: TR('Preferences saved') });
      }
    });
  });
}

export default initPrefs;
