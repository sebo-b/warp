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

  // Language picker — an M.Dropdown (flag+name list), not a FormSelect: the
  // native <option> can't render images, but M.Dropdown's items can. The row is
  // server-rendered only when >1 language is configured; otherwise these are
  // null and the loaded language is preserved unchanged on save. The trigger
  // deliberately lacks the `.dropdown-trigger` class so main.js's generic
  // initDropdowns() (which has no modal `container`) doesn't grab it; we init
  // it here with `container: prefModalEl` so the list stays inside the modal.
  var langTriggerEl = document.querySelector('.pref-lang-trigger');
  var langDropdownEl = document.getElementById('pref_language_dropdown');
  var langFlagEl = langTriggerEl ? langTriggerEl.querySelector('.pref-lang-flag') : null;
  var langNameEl = langTriggerEl ? langTriggerEl.querySelector('.pref-lang-name') : null;
  var langValue = null;          // null = Default
  var langInstance = null;       // M.Dropdown instance

  if (!prefModalEl || !planSelectEl || !daySelectEl || !saveBtn || !sliderEl)
    return;

  // Render the FormSelect dropdowns into the dialog (not the scrolling
  // .modal-content), so a long list isn't clipped by the modal's overflow.
  var SELECT_OPTS = { dropdownOptions: { container: prefModalEl } };

  var DEFAULT_TIME = [9 * 3600, 17 * 3600];
  var loadedPrefs = null;
  var loadedLang = null;  // normalized: null = Default; tracked for reload-only-if-changed
  var slider = null;

  if (langTriggerEl && langDropdownEl && !langInstance) {
    langInstance = M.Dropdown.init(langTriggerEl, {
      container: prefModalEl,
      coverTrigger: false,
      constrainWidth: true
    });
    // Selecting a language updates the trigger, marks the modal dirty, closes
    // the dropdown. (Delegated click on the dropdown-content, which lives in
    // the modal dialog so it shares the modal's top layer; the dialog wrapper
    // is overflow-visible so the menu can escape the frame rather than being
    // clipped.)
    langDropdownEl.addEventListener('click', function (ev) {
      var a = ev.target.closest && ev.target.closest('a.pref-lang-opt');
      if (!a) return;
      ev.preventDefault();
      setLangUI(a.getAttribute('data-lang') || null);
      warpDialog.getInstance(prefModalEl)?.markDirty();
      if (langInstance) langInstance.close();
    });
  }

  // Copy the flag+name of the option matching the resolved code into the
  // folded trigger, and mark that option active. There is no "Default" entry:
  // a NULL pref (no explicit choice) displays as the deployment default
  // language (applied, not selectable), but langValue stays null so saving
  // without picking anything keeps NULL (the default keeps applying).
  function setLangUI(code) {
    langValue = code || null;
    if (!langTriggerEl) return;
    var displayCode = code || (window.warpGlobals.defaultLanguage || 'en');
    var opt = langDropdownEl.querySelector('a[data-lang="' + displayCode + '"]');
    if (!opt) return;
    var optName = opt.querySelector('.pref-lang-name');
    if (langNameEl && optName) langNameEl.textContent = optName.textContent;
    var optImg = opt.querySelector('img');
    if (langFlagEl && optImg) { langFlagEl.src = optImg.src; langFlagEl.hidden = false; }
    langDropdownEl.querySelectorAll('a.pref-lang-opt').forEach(function (a) {
      a.classList.remove('active');
    });
    opt.classList.add('active');
  }

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
    loadedLang = loadedPrefs ? (loadedPrefs.language || null) : null;
    if (langTriggerEl) setLangUI(loadedLang);
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
    // Omit `language` when prefs never loaded (stale tab / failed GET / a slow
    // GET overwriting an in-flight selection): POSTing a boot-time snapshot
    // would wipe the stored pref + cookie with no reload to reveal it. When
    // loaded, send the selection (null = no pinned language, normalized from
    // ""). When the Language row is hidden (single language) send the loaded
    // value unchanged to preserve it.
    if (loadedPrefs !== null) {
      payload.language = langTriggerEl ? langValue : loadedLang;
    }
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
    var prevLang = loadedLang;
    postPrefs(null, function (err) {
      if (err) {
        M.toast({ text: TR('Error saving preferences') });
        return;
      }
      // Reload only if the language actually changed (normalized compare:
      // "" and null are the same Default). The server sets/deletes the cookie
      // too, but the client must do it before the reload so the new page paints
      // in the chosen language immediately. Mirror the pending-toast pattern
      // from main.js so the "Preferences saved" toast survives the reload.
      var newLang = langTriggerEl ? langValue : loadedLang;
      if (newLang !== prevLang) {
        if (newLang != null) {
          document.cookie = 'warp_lang=' + newLang + ';path=/;max-age=31536000;samesite=lax';
        } else {
          document.cookie = 'warp_lang=;path=/;max-age=0';
        }
        window.sessionStorage.setItem('pendingToast', TR('Preferences saved'));
        window.location.reload();
      } else {
        M.toast({ text: TR('Preferences saved') });
      }
    });
  });
}

export default initPrefs;