'use strict';

// Materialize 2.x — CSS first so app rules win the cascade, then JS.
// The published sass/materialize.scss is unusable (forwards non-shipped
// files), so we consume the prebuilt dist CSS+JS from the one pinned package.
import '@materializecss/materialize/dist/css/materialize.css';
import './style.css';
import 'nouislider/dist/nouislider.css';
import * as Materialize from '@materializecss/materialize';
import Polyglot from 'node-polyglot';
import noUiSlider from 'nouislider';

// Expose Materialize as the global `M` the inline template scripts expect.
// `import * as` yields a frozen module namespace, so we spread it into a
// plain object and add the two 1.x helpers 2.x renamed/removed:
//   M.toast(opts)        -> 2.x dropped the `toast` function; construct a Toast.
//   M.updateTextFields() -> 2.x floats labels via CSS :not(:placeholder-shown);
//      we just ensure inputs carry placeholder=" " so empty-state labels rest.
//   M.Modal              -> 2.x Modal is a no-op stub (open/close do nothing,
//      options are dead). Replace with a compat layer over native <dialog>
//      so the ~25 existing M.Modal.init/getInstance/open/close call sites and
//      the onOpenStart/onOpenEnd/onCloseStart/onCloseEnd options keep working.
//   M.Autocomplete.init  -> 2.x changed `data` to [{id,text}] and onAutocomplete
//      to receive AutocompleteData[]; wrap to accept the 1.x {key:null} map and
//      pass the selected string back, so call sites are unchanged.
const _AcInit = Materialize.Autocomplete.init.bind(Materialize.Autocomplete);
function warpAutocompleteInit(els, options) {
  if (options && options.data && !Array.isArray(options.data)) {
    var map = options.data;
    options.data = Object.keys(map).map(function (k) {
      return { id: k, text: k, image: map[k] || undefined };
    });
  }
  if (options && options.onAutocomplete) {
    var orig = options.onAutocomplete;
    options.onAutocomplete = function (entries) {
      var e = entries && entries[0];
      return orig.call(this, e ? (e.text || e.id) : e);
    };
  }
  return _AcInit(els, options);
}

class WarpModalCompat {
  constructor(el, options) {
    this.el = el;
    this.options = Object.assign({
      dismissible: true,
      onOpenStart: null, onOpenEnd: null,
      onCloseStart: null, onCloseEnd: null
    }, options || {});
    this._onClose = this._onClose.bind(this);
    this._onCancel = this._onCancel.bind(this);
    this._onBackdrop = this._onBackdrop.bind(this);
    el.addEventListener('click', this._onBackdrop);
    el.addEventListener('cancel', this._onCancel);
    el.addEventListener('close', this._onClose);
  }
  _onBackdrop(ev) { if (this.options.dismissible !== false && ev.target === this.el) this.close(); }
  _onCancel(ev) { if (this.options.dismissible === false) ev.preventDefault(); }
  _onClose() { this.el.classList.remove('open'); if (this.options.onCloseEnd) this.options.onCloseEnd.call(this.el); }
  open() {
    if (this.options.onOpenStart) this.options.onOpenStart.call(this.el);
    this.el.classList.add('open');
    this.el.showModal();
    var self = this;
    requestAnimationFrame(function () {
      if (self.options.onOpenEnd) self.options.onOpenEnd.call(self.el);
    });
    return this;
  }
  close() {
    if (this.options.onCloseStart) this.options.onCloseStart.call(this.el);
    this.el.close();
    return this;
  }
  destroy() {
    this.el.removeEventListener('click', this._onBackdrop);
    this.el.removeEventListener('cancel', this._onCancel);
    this.el.removeEventListener('close', this._onClose);
    this.el._warpModal = undefined;
  }
  static init(els, options) {
    var single = els && els.nodeType === 1; // HTMLElement
    var list = single ? [els] : (els || []);
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (!el || el._warpModal) { out.push(el && el._warpModal); continue; }
      el._warpModal = new WarpModalCompat(el, options);
      out.push(el._warpModal);
    }
    return single ? out[0] : out;
  }
  static getInstance(el) { return el && el._warpModal ? el._warpModal : null; }
}

const M = Object.assign({}, Materialize, {
  toast: function (opts) { return new Materialize.Toast(opts); },
  updateTextFields: function () {
    document.querySelectorAll(
      '.input-field input:not([placeholder]), .input-field textarea:not([placeholder])'
    ).forEach(function (el) { el.setAttribute('placeholder', ' '); });
  },
  Modal: WarpModalCompat,
  Autocomplete: Object.assign({}, Materialize.Autocomplete, { init: warpAutocompleteInit }),
});
window.M = M;

if (!window?.warpGlobals?.i18nUrl)
  throw Error('warpGlobals.i18nUrl must be defined');

(function loadI18n() {
  var xhr = new XMLHttpRequest();
  xhr.open('GET', window.warpGlobals.i18nUrl, false);
  xhr.send();
  if (xhr.status !== 200)
    throw Error('Failed to load i18n: ' + xhr.status);
  window.warpGlobals.i18n = JSON.parse(xhr.responseText);
})();

let locale = window.warpGlobals.i18n.locale;
let phrases = window.warpGlobals.i18n.phrases;
let weekdaysShort = window.warpGlobals.i18n.weekdaysShort;

if (!locale || !phrases)
  throw Error('locale and phrases must be defined');

window.warpGlobals.i18n.polyglot = new Polyglot({
  locale: locale,
  phrases: { ...phrases, weekdaysShort }
})

window.TR = window.warpGlobals.i18n.polyglot.t.bind(window.warpGlobals.i18n.polyglot);
window.TR.has = window.warpGlobals.i18n.polyglot.has.bind(window.warpGlobals.i18n.polyglot);

const trClass = 'TR';

window.TR.updateDOM = function() {
  for (let e of document.querySelectorAll("."+trClass)) {
    let key = e.textContent.replace(/^\s*|\s*$/g,'').replace(/\s*\n\s*/g,' ');
    e.textContent = window.warpGlobals.i18n.polyglot.t(key);
    e.classList.remove(trClass);
  }
}

window.TR.inline = function() {
  document.write(
    window.warpGlobals.i18n.polyglot.t.apply(
      window.warpGlobals.i18n.polyglot,
      arguments));
}

function initDropdowns() {
  for (let el of document.querySelectorAll('.dropdown-trigger')) {
    M.Dropdown.init(el, {
      coverTrigger: false,
      constrainWidth: false
    });
  }
}

function formatHHMM(seconds) {
  if (seconds >= 24 * 3600) return "23:59";
  return new Date(seconds * 1000).toISOString().substring(11, 16);
}

function initPrefs() {
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

  var DEFAULT_TIME = [9 * 3600, 17 * 3600];
  var loadedPrefs = null;
  var slider = null;

  function applyPrefsToUI() {
    var time = (loadedPrefs && loadedPrefs.default_time) ? loadedPrefs.default_time : DEFAULT_TIME;
    planSelectEl.value = (loadedPrefs && loadedPrefs.default_plan) ? String(loadedPrefs.default_plan) : "";
    daySelectEl.value = (loadedPrefs && loadedPrefs.default_day) ? loadedPrefs.default_day : "same";
    M.FormSelect.init(planSelectEl);
    M.FormSelect.init(daySelectEl);
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
      slider.on('update', function(values, handle, unencoded) {
        minDiv.innerText = formatHHMM(unencoded[0]);
        maxDiv.innerText = formatHHMM(unencoded[1]);
      });
    }

    applyPrefsToUI();
  }

  M.FormSelect.init(planSelectEl);
  M.FormSelect.init(daySelectEl);

  M.Modal.init(prefModalEl, {
    onOpenStart: ensureSlider,
    dismissible: false
  });

  fetch('/xhr/prefs')
    .then(function(r) {
      if (!r.ok) throw new Error('Failed to load preferences');
      return r.json();
    })
    .then(function(prefs) {
      loadedPrefs = prefs;
      applyPrefsToUI();
    })
    .catch(function() {});

  function postPrefs(extraPayload, callback) {
    if (!slider) return;
    var payload = {
      default_plan: planSelectEl.value || undefined,
      default_day: daySelectEl.value,
      default_time: slider.get(true).map(function(v) { return Math.round(v); }),
      zone_show_seat_names: showSeatNamesEl ? showSeatNamesEl.checked : false,
      zone_show_booking_preview: showBookingPreviewEl ? showBookingPreviewEl.checked : false,
      zone_show_assigned_names: showAssignedNamesEl ? showAssignedNamesEl.checked : false
    };
    if (extraPayload) Object.assign(payload, extraPayload);

    fetch('/xhr/prefs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw e; });
      return r.json();
    })
    .then(function(prefs) {
      loadedPrefs = prefs;
      applyPrefsToUI();
      window.warpGlobals = window.warpGlobals || {};
      window.warpGlobals['zonePreviewPrefs'] = {
        show_seat_names: prefs.zone_show_seat_names,
        show_booking_preview: prefs.zone_show_booking_preview,
        show_assigned_names: prefs.zone_show_assigned_names
      };
      document.dispatchEvent(new CustomEvent('warp:prefsSaved', {
        detail: { zonePreviewPrefs: window.warpGlobals['zonePreviewPrefs'] }
      }));
      if (callback) callback(null, prefs);
    })
    .catch(function(err) {
      if (callback) callback(err);
    });
  }

  saveBtn.addEventListener('click', function() {
    postPrefs(null, function(err) {
      if (err) {
        M.toast({ text: TR('Error saving preferences') });
      } else {
        M.toast({ text: TR('Preferences saved') });
      }
    });
  });
}

function initCalendar() {
  var calModalEl = document.getElementById('calendar_modal');
  if (!calModalEl) return;

  var calEnabledEl = document.getElementById('cal_enabled');
  var calUrlInput = document.getElementById('cal_url');
  var calUrlBtns = document.getElementById('cal_url_btns');
  var calRegenBtn = document.getElementById('cal_regenerate');
  var calCopyBtn = document.getElementById('cal_copy');
  var calUrlEyeBtn = document.getElementById('cal_url_eye_btn');
  var calUrlEye = document.getElementById('cal_url_eye');
  var calReminderSection = document.getElementById('cal_reminder_section');
  var calSharedSection = document.getElementById('cal_shared_section');
  var calZonesEl = document.getElementById('cal_zones');
  var calMissingAheadEl = document.getElementById('cal_missing_ahead');
  var calReleaseAheadEl = document.getElementById('cal_release_ahead');
  var calTimeInputEl = document.getElementById('cal_time_input');
  var calTypeTabs = document.getElementById('cal_type_tabs');
  var calTypeTabsRow = document.getElementById('cal_type_tabs_row');
  var calTypeReminderTabLi = document.getElementById('cal_type_reminders_tab');
  var calTypeTabsInstance = null;
  var saveBtn = document.getElementById('cal_save_btn');
  var calCancelBtn = document.getElementById('cal_cancel_btn');

  var SELECT_OPTS = { dropdownOptions: { container: document.body } };

  // Sun=64, Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32
  var WEEKDAY_BITS = [64, 1, 2, 4, 8, 16, 32];

  var calToken = null;
  var weekdayMask = 0;
  var timepicker = null;
  var selectedType = 'all';


  // Build weekday chip buttons
  var weekdayContainer = document.getElementById('cal_weekday_chips');
  weekdaysShort.forEach(function(day) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weekday-chip waves-effect';
    btn.textContent = day;
    weekdayContainer.appendChild(btn);
  });

  var weekdayChips = calModalEl.querySelectorAll('.weekday-chip');
  weekdayChips.forEach(function(chip, i) {
    chip.addEventListener('click', function() {
      weekdayMask ^= WEEKDAY_BITS[i];
      chip.classList.toggle('active');
      updateReminderTabState();
    });
  });

  function populateAheadSelect(el) {
    if (!el) return;
    el.innerHTML = '';
    var opt0 = document.createElement('option');
    opt0.value = '0';
    opt0.textContent = TR("Don't remind");
    el.appendChild(opt0);
    for (var n = 1; n <= 7; n++) {
      var opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = TR('Remind me %{smart_count} days before', { smart_count: n });
      el.appendChild(opt);
    }
  }

  populateAheadSelect(calMissingAheadEl);
  populateAheadSelect(calReleaseAheadEl);

  if (calMissingAheadEl) M.FormSelect.init(calMissingAheadEl, SELECT_OPTS);
  if (calReleaseAheadEl) M.FormSelect.init(calReleaseAheadEl, SELECT_OPTS);

  if (calMissingAheadEl) calMissingAheadEl.addEventListener('change', function() { updateSharedSectionState(); updateReminderTabState(); });
  if (calReleaseAheadEl) calReleaseAheadEl.addEventListener('change', function() { updateSharedSectionState(); updateReminderTabState(); });
  if (calZonesEl) calZonesEl.addEventListener('change', function() { updateReminderTabState(); });

  function buildCalIcalUrl(token, type) {
    if (!token) return '';
    var base = window.location.protocol + '//' + window.location.host + '/calendar/' + encodeURIComponent(window.warpGlobals.login) + '/events.ics?t=' + encodeURIComponent(token);
    if (type === 'bookings' || type === 'reminders') return base + '&type=' + type;
    return base;
  }

  // The reminders feed only produces events when reminders are fully and validly
  // configured (same rule as validateReminders): at least one reminder type, plus
  // a weekday and a zone. The "Reminders only" tab mirrors that, recomputed live.
  function remindersFullyConfigured() {
    var missingVal = calMissingAheadEl ? parseInt(calMissingAheadEl.value) || 0 : 0;
    var releaseVal = calReleaseAheadEl ? parseInt(calReleaseAheadEl.value) || 0 : 0;
    if (!(missingVal > 0 || releaseVal > 0)) return false;
    if (!weekdayMask) return false;
    var hasZone = calZonesEl && Array.from(calZonesEl.options).some(function(o) { return o.selected; });
    return !!hasZone;
  }

  function updateReminderTabState() {
    if (!calTypeReminderTabLi) return;
    var remindersEnabled = remindersFullyConfigured();
    calTypeReminderTabLi.classList.toggle('disabled', !remindersEnabled);
    if (!remindersEnabled && selectedType === 'reminders') {
      selectedType = 'all';
      if (calTypeTabsInstance) calTypeTabsInstance.select('cal-type-all');
    }
  }

  function updateSharedSectionState() {
    if (!calSharedSection) return;
    var masterEnabled = calEnabledEl && calEnabledEl.checked;
    if (!masterEnabled) {
      calSharedSection.classList.remove('cal-section-disabled');
      return;
    }
    var missingVal = calMissingAheadEl ? parseInt(calMissingAheadEl.value) || 0 : 0;
    var releaseVal = calReleaseAheadEl ? parseInt(calReleaseAheadEl.value) || 0 : 0;
    calSharedSection.classList.toggle('cal-section-disabled', !(missingVal > 0 || releaseVal > 0));
  }

  function validateReminders() {
    // When the master switch is off the iCal endpoint is inactive and no reminders
    // fire, so don't block the save on incomplete reminder settings.
    if (!calEnabledEl || !calEnabledEl.checked) return true;

    var missingVal = calMissingAheadEl ? parseInt(calMissingAheadEl.value) || 0 : 0;
    var releaseVal = calReleaseAheadEl ? parseInt(calReleaseAheadEl.value) || 0 : 0;
    if (missingVal > 0 || releaseVal > 0) {
      if (!weekdayMask) {
        M.toast({ text: TR('Active reminders require at least one weekday.') });
        return false;
      }
      var hasZone = calZonesEl && Array.from(calZonesEl.options).some(function(o) { return o.selected; });
      if (!hasZone) {
        M.toast({ text: TR('Active reminders require at least one zone to monitor.') });
        return false;
      }
    }
    return true;
  }

  function updateCalEnabledUI() {
    var enabled = calEnabledEl && calEnabledEl.checked;
    if (calTypeTabsRow) calTypeTabsRow.classList.toggle('cal-section-disabled', !enabled);
    updateReminderTabState();
    if (calReminderSection) calReminderSection.classList.toggle('cal-section-disabled', !enabled);
    // URL action buttons require a token, which only exists after a save with iCal on.
    if (calUrlBtns) calUrlBtns.classList.toggle('cal-section-disabled', !(enabled && calToken));
    if (calUrlInput) {
      calUrlInput.value = enabled && calToken ? buildCalIcalUrl(calToken, selectedType) : '';
      M.updateTextFields();
    }
    updateSharedSectionState();
  }

  function updateWeekdayChips() {
    weekdayChips.forEach(function(chip, i) {
      chip.classList.toggle('active', !!(weekdayMask & WEEKDAY_BITS[i]));
    });
  }

  function getTimepickerSeconds() {
    if (!calTimeInputEl || !calTimeInputEl.value) return 79200;
    var parts = calTimeInputEl.value.split(':');
    if (parts.length < 2) return 79200;
    return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60;
  }

  function setTimepickerValue(seconds) {
    if (!calTimeInputEl) return;
    calTimeInputEl.value = formatHHMM(seconds);
    M.updateTextFields();
  }

  function applyToUI(data) {
    calToken = data.ical_token || null;
    if (calEnabledEl) calEnabledEl.checked = !!data.ical_enabled;

    updateCalEnabledUI();

    weekdayMask = data.reminder_weekdays || 0;
    updateWeekdayChips();

    setTimepickerValue(data.reminder_time != null ? data.reminder_time : 79200);

    if (calMissingAheadEl) {
      var aVal = data.reminder_ahead_days != null ? data.reminder_ahead_days : 0;
      calMissingAheadEl.value = String(aVal);
      M.FormSelect.init(calMissingAheadEl, SELECT_OPTS);
    }

    if (calReleaseAheadEl) {
      var rVal = data.reminder_release_ahead_days != null ? data.reminder_release_ahead_days : 0;
      calReleaseAheadEl.value = String(rVal);
      M.FormSelect.init(calReleaseAheadEl, SELECT_OPTS);
    }

    // Recompute after the reminder selects have been populated above.
    updateReminderTabState();

    if (calZonesEl) {
      var zids = data.reminder_zones || [];
      Array.from(calZonesEl.options).forEach(function(o) {
        o.selected = zids.indexOf(parseInt(o.value)) !== -1;
      });
      M.FormSelect.init(calZonesEl, SELECT_OPTS);
    }

    updateSharedSectionState();
  }

  function ensureTimepicker() {
    if (!calTimeInputEl || timepicker) return;
    timepicker = M.Timepicker.init(calTimeInputEl, {
      twelveHour: false,
      container: document.body
    });
  }

  function resetUrlVisibility() {
    if (calUrlInput) calUrlInput.type = 'password';
    if (calUrlEye) calUrlEye.textContent = 'visibility';
  }

  function onCalTabShow(tabEl) {
    var id = tabEl ? tabEl.id : '';
    if (id === 'cal-type-bookings') selectedType = 'bookings';
    else if (id === 'cal-type-reminders') selectedType = 'reminders';
    else selectedType = 'all';
    if (calUrlInput) {
      calUrlInput.value = (calEnabledEl && calEnabledEl.checked && calToken)
        ? buildCalIcalUrl(calToken, selectedType)
        : '';
      M.updateTextFields();
    }
  }

  // Materialize measures the tab indicator from element widths, which are only
  // correct once the modal is fully shown. Re-create the instance on each open
  // (after the open animation) so the indicator lands on the right tab.
  function initCalTabs() {
    if (!calTypeTabs) return;
    if (calTypeTabsInstance) calTypeTabsInstance.destroy();
    calTypeTabsInstance = M.Tabs.init(calTypeTabs, { onShow: onCalTabShow });
    var tabIndicator = calTypeTabs.querySelector('.indicator');
    if (tabIndicator) tabIndicator.classList.add('orange', 'accent-4');
    calTypeTabsInstance.select('cal-type-' + selectedType);
  }

  M.Modal.init(calModalEl, {
    dismissible: false,
    onOpenStart: function() {
      ensureTimepicker();
      resetUrlVisibility();
      calModalEl.scrollTop = 0;
      var content = calModalEl.querySelector('.modal-content');
      if (content) content.scrollTop = 0;
      selectedType = 'all';
      if (calUrlInput) {
        calUrlInput.value = '';
        M.updateTextFields();
      }
      fetch('/xhr/calendar')
        .then(function(r) {
          if (!r.ok) throw new Error('Failed to load calendar settings');
          return r.json();
        })
        .then(function(data) { applyToUI(data); })
        .catch(function() { updateCalEnabledUI(); });
    },
    onOpenEnd: initCalTabs,
    onCloseEnd: resetUrlVisibility
  });

  function saveCalendar(payload, callback) {
    fetch('/xhr/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw e; });
      return r.json();
    })
    .then(function(data) {
      applyToUI(data);
      if (callback) callback(null, data);
    })
    .catch(function(err) {
      if (callback) callback(err);
    });
  }

  // Token-only request: reserves or rotates the iCal token without committing the
  // user's toggle position. ical_enabled in the DB only flips on Save, so Cancel
  // after a first-time toggle leaves the integration disabled (the token may stay).
  function postTokenRequest(payload, callback) {
    fetch('/xhr/calendar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw e; });
      return r.json();
    })
    .then(function(data) {
      calToken = data.ical_token || null;
      updateCalEnabledUI();
      if (callback) callback(null, data);
    })
    .catch(function(err) {
      if (callback) callback(err);
    });
  }

  if (calCancelBtn) {
    calCancelBtn.addEventListener('click', function() {
      M.Modal.getInstance(calModalEl).close();
    });
  }

  if (calEnabledEl) {
    calEnabledEl.addEventListener('change', function() {
      if (this.checked && !calToken) {
        postTokenRequest({ ensure_token: true }, function(err) {
          if (err) M.toast({ text: TR('Error saving calendar settings') });
        });
      } else {
        updateCalEnabledUI();
      }
    });
  }

  if (calUrlEyeBtn && calUrlInput && calUrlEye) {
    calUrlEyeBtn.addEventListener('click', function() {
      var isPassword = calUrlInput.type === 'password';
      calUrlInput.type = isPassword ? 'text' : 'password';
      calUrlEye.textContent = isPassword ? 'visibility_off' : 'visibility';
    });
  }

  if (calRegenBtn) {
    calRegenBtn.addEventListener('click', function() {
      if (!confirm(TR('Regenerating the URL will invalidate your current calendar subscription link. Continue?')))
        return;
      postTokenRequest({ ical_regenerate_token: true }, function(err) {
        if (err) {
          M.toast({ text: TR('Error regenerating URL') });
        } else {
          M.toast({ text: TR('Calendar URL regenerated') });
        }
      });
    });
  }

  if (calCopyBtn) {
    calCopyBtn.addEventListener('click', function() {
      var url = buildCalIcalUrl(calToken, selectedType);
      if (!url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          M.toast({ text: TR('URL copied to clipboard') });
        }).catch(function() {
          M.toast({ text: TR('Failed to copy') });
        });
      } else {
        var tmp = document.createElement('textarea');
        tmp.value = url;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
        M.toast({ text: TR('URL copied to clipboard') });
      }
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function() {
      if (!validateReminders()) return;

      var zones = calZonesEl
        ? Array.from(calZonesEl.options).filter(function(o) { return o.selected; }).map(function(o) { return parseInt(o.value); })
        : [];

      var payload = {
        ical_enabled: calEnabledEl ? !!calEnabledEl.checked : false,
        reminder_weekdays: weekdayMask,
        reminder_ahead_days: calMissingAheadEl ? parseInt(calMissingAheadEl.value) || 0 : 0,
        reminder_time: getTimepickerSeconds(),
        reminder_release_ahead_days: calReleaseAheadEl ? parseInt(calReleaseAheadEl.value) || 0 : 0,
        reminder_zones: zones
      };

      saveCalendar(payload, function(err) {
        if (err) {
          M.toast({ text: TR('Error saving calendar settings') });
        } else {
          M.toast({ text: TR('Calendar settings saved') });
          M.Modal.getInstance(calModalEl).close();
        }
      });

    });
  }
}

function initChangePassword() {
  var cpModalEl = document.getElementById('change_password_modal');
  var saveBtn = document.getElementById('cp_save_btn');

  if (!cpModalEl || !saveBtn)
    return;

  var oldPwEl = document.getElementById('cp_old_password');
  var newPwEl = document.getElementById('cp_new_password');
  var repeatPwEl = document.getElementById('cp_repeat_password');

  var minLen = window.warpGlobals.minPasswordLength || 6;

  function clearFields() {
    oldPwEl.value = '';
    newPwEl.value = '';
    repeatPwEl.value = '';
    M.updateTextFields();
  }

  var cpModal = M.Modal.init(cpModalEl, {
    onCloseEnd: clearFields
  });

  saveBtn.addEventListener('click', function() {
    var oldPassword = oldPwEl.value;
    var newPassword = newPwEl.value;
    var repeatPassword = repeatPwEl.value;

    if (!oldPassword || !newPassword || !repeatPassword) {
      M.toast({ text: TR('All fields are mandatory') });
      return;
    }

    if (newPassword.length < minLen) {
      M.toast({ text: TR('Password must be at least %{n} characters', { n: minLen }) });
      return;
    }

    if (newPassword !== repeatPassword) {
      M.toast({ text: TR("Passwords don't match") });
      return;
    }

    var payload = {
      old_password: oldPassword,
      new_password: newPassword
    };

    fetch(window.warpGlobals.URLs['changePassword'], {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    .then(function(r) {
      if (!r.ok) return r.json().then(function(e) { throw e; });
      return r.json();
    })
    .then(function() {
      cpModal.close();
      M.toast({ text: TR('Password changed successfully') });
    })
    .catch(function(err) {
      M.toast({ text: err.msg || TR('Error changing password') });
    });
  });
}

document.addEventListener("DOMContentLoaded", function(e) {
  window.TR.updateDOM();
  M.updateTextFields(); // ensure placeholder=" " so 2.x CSS label-float works

  let pendingToast = window.sessionStorage.getItem('pendingToast');
  if (pendingToast) {
    window.sessionStorage.removeItem('pendingToast');
    M.toast({text: pendingToast});
  }

  initDropdowns();
  initPrefs();
  initCalendar();
  initChangePassword();
  initTriggerClasses();
});

// Materialize 2.x removed the .modal-trigger / .sidenav-trigger auto-init
// classes (click-to-open was automatic in 1.x). Replicate that behaviour with
// delegated listeners so it covers triggers added dynamically by view JS, and
// so it works regardless of init order. Sidenav triggers are guarded to real
// .sidenav elements only — WARP reuses sidenav-trigger on the zone sidepanel
// (a plain div, not a Materialize sidenav), which must keep its own handling.
function initTriggerClasses() {
  document.addEventListener('click', function(ev) {
    var modalTrig = ev.target.closest && ev.target.closest('.modal-trigger');
    if (modalTrig) {
      var sel = modalTrig.getAttribute('href');
      if (sel && sel !== '#') {
        var modalEl = document.querySelector(sel);
        if (modalEl) {
          ev.preventDefault();
          (M.Modal.getInstance(modalEl) || M.Modal.init(modalEl, {})).open();
        }
      }
      return;
    }
    var sidenavTrig = ev.target.closest && ev.target.closest('.sidenav-trigger');
    if (sidenavTrig) {
      var id = sidenavTrig.getAttribute('data-target');
      var sn = id && document.getElementById(id);
      if (sn && sn.classList.contains('sidenav')) {
        ev.preventDefault();
        (M.Sidenav.getInstance(sn) || M.Sidenav.init(sn, {})).open();
      }
      return;
    }
    // .modal-close: 2.x dropped the auto-close class behaviour; close the
    // enclosing <dialog class="modal"> (instance.close() if init'd, else native close).
    var modalClose = ev.target.closest && ev.target.closest('.modal-close');
    if (modalClose) {
      var dlg = modalClose.closest('.modal');
      if (dlg) {
        ev.preventDefault();
        var inst = M.Modal.getInstance(dlg);
        if (inst) inst.close(); else dlg.close();
      }
    }
  });
}
