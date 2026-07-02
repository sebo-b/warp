'use strict';

import { M, warpLiftSelect } from '../materialize.js';
import warpDialog from '../dialog.js';
import * as bootstrap from '../bootstrap.js';
import Utils from '../../views/modules/utils.js';

function formatHHMM(seconds) {
  if (seconds >= 24 * 3600) return "23:59";
  return new Date(seconds * 1000).toISOString().substring(11, 16);
}

export function initCalendar() {
  var calModalEl = document.getElementById('calendar_modal');
  if (!calModalEl) return;

  var weekdaysShort = window.warpGlobals.i18n.weekdaysShort;

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

  // Keep the FormSelect dropdowns inside the calendar modal (a <dialog> shown
  // via showModal, hence in the top layer). Appending to document.body renders
  // them behind the modal's backdrop (blurred, unselectable). calModalEl is in
  // the modal's top-layer subtree so the dropdowns appear above the modal.
  var SELECT_OPTS = { dropdownOptions: { container: calModalEl } };

  // (In-modal <select> dropdowns are lifted into the top layer by warpDialog on
  // open, so they are never clipped by the modal — see WarpDialog.open().)

  // Sun=64, Mon=1, Tue=2, Wed=4, Thu=8, Fri=16, Sat=32
  var WEEKDAY_BITS = [64, 1, 2, 4, 8, 16, 32];

  var calToken = null;
  var weekdayMask = 0;
  var timepicker = null;
  var selectedType = 'all';

  // Build weekday chip buttons
  var weekdayContainer = document.getElementById('cal_weekday_chips');
  weekdaysShort.forEach(function (day) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'weekday-chip waves-effect';
    btn.textContent = day;
    weekdayContainer.appendChild(btn);
  });

  var weekdayChips = calModalEl.querySelectorAll('.weekday-chip');
  weekdayChips.forEach(function (chip, i) {
    chip.addEventListener('click', function () {
      weekdayMask ^= WEEKDAY_BITS[i];
      chip.classList.toggle('active');
      updateReminderTabState();
      warpDialog.getInstance(calModalEl)?.markDirty();
    });
  });

  // The <option> list used to be Jinja-rendered server-side from
  // accessibleZones; now populated client-side from /xhr/bootstrap on open.
  function populateZoneOptions(data) {
    var selected = calZonesEl ? Array.from(calZonesEl.selectedOptions).map(function (o) { return o.value; }) : [];
    if (!calZonesEl) return;
    calZonesEl.innerHTML = '';
    (data.zones || []).forEach(function (z) {
      var opt = document.createElement('option');
      opt.value = String(z.id);
      opt.textContent = z.name;
      opt.selected = selected.indexOf(String(z.id)) !== -1;
      calZonesEl.appendChild(opt);
    });
  }

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

  if (calMissingAheadEl) calMissingAheadEl.addEventListener('change', function () { updateSharedSectionState(); updateReminderTabState(); });
  if (calReleaseAheadEl) calReleaseAheadEl.addEventListener('change', function () { updateSharedSectionState(); updateReminderTabState(); });
  if (calZonesEl) calZonesEl.addEventListener('change', function () { updateReminderTabState(); });

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
    var hasZone = calZonesEl && Array.from(calZonesEl.options).some(function (o) { return o.selected; });
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
      var hasZone = calZonesEl && Array.from(calZonesEl.options).some(function (o) { return o.selected; });
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
    weekdayChips.forEach(function (chip, i) {
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
      warpLiftSelect(calMissingAheadEl);
    }

    if (calReleaseAheadEl) {
      var rVal = data.reminder_release_ahead_days != null ? data.reminder_release_ahead_days : 0;
      calReleaseAheadEl.value = String(rVal);
      M.FormSelect.init(calReleaseAheadEl, SELECT_OPTS);
      warpLiftSelect(calReleaseAheadEl);
    }

    // Recompute after the reminder selects have been populated above.
    updateReminderTabState();

    if (calZonesEl) {
      var zids = data.reminder_zones || [];
      Array.from(calZonesEl.options).forEach(function (o) {
        o.selected = zids.indexOf(parseInt(o.value)) !== -1;
      });
      M.FormSelect.init(calZonesEl, SELECT_OPTS);
      warpLiftSelect(calZonesEl);
    }

    updateSharedSectionState();
  }

  function ensureTimepicker() {
    if (!calTimeInputEl || timepicker) return;
    // The time is picked from the clock only — typing into the field while the
    // picker is open is unsupported and glitchy, so make it readonly. (A click
    // still opens the picker; the picker dialog closes on outside-click.)
    calTimeInputEl.readOnly = true;
    timepicker = M.Timepicker.init(calTimeInputEl, {
      twelveHour: false,
      // A clock selection is a real edit -> mark the calendar modal dirty so an
      // accidental Esc/outside-click won't silently discard it.
      onSelect: function () { warpDialog.getInstance(calModalEl)?.markDirty(); },
      // autoSubmit:true (M2 default) skips the Done/Cancel buttons AND calls
      // done() on clock-release which sets the value but never hides the modal,
      // so the picker opens with no buttons and never closes. autoSubmit:false
      // creates the Ok/Cancel buttons; Ok calls confirm() -> done() + hide().
      autoSubmit: false,
      // displayPlugin:'modal' wraps the clock face in a <dialog> (hidden until
      // opened); without it M2 leaves the bare .timepicker-container in the DOM,
      // always visible at the bottom of the page. Move that dialog into the
      // calendar modal so it renders in the modal's top-layer subtree (above
      // it) instead of at body level behind the modal.
      displayPlugin: 'modal'
    });
    if (timepicker.displayPlugin && timepicker.displayPlugin.container) {
      calModalEl.appendChild(timepicker.displayPlugin.container);
    }
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

  warpDialog(calModalEl, {
    onOpenStart: function () {
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
      bootstrap.get().then(function (data) { populateZoneOptions(data); });
      // Via Utils.xhr (not raw fetch): shares the 401->login redirect + spinner
      // and stays mount-prefix-correct (warpGlobals.URLs.calendar is url_for-
      // based). errorOnFailure:false — a benign load failure just leaves the
      // modal at defaults; the 401 redirect fires regardless, before this catch.
      Utils.xhr.get(window.warpGlobals.URLs['calendar'], { toastOnSuccess: false, errorOnFailure: false })
        .then(function (result) { applyToUI(result.response); })
        .catch(function () { updateCalEnabledUI(); });
    },
    onOpenEnd: initCalTabs,
    onCloseEnd: resetUrlVisibility
  });

  // Utils.xhr for both POST helpers below: shares the 401 redirect + spinner and
  // stays mount-prefix-correct. Each caller's callback drives its own toast, so
  // errorOnFailure:false suppresses the duplicate generic Utils error modal.
  function saveCalendar(payload, callback) {
    Utils.xhr.post(window.warpGlobals.URLs['calendar'], payload, { toastOnSuccess: false, errorOnFailure: false })
      .then(function (result) {
        applyToUI(result.response);
        if (callback) callback(null, result.response);
      })
      .catch(function (err) {
        if (callback) callback(err);
      });
  }

  // Token-only request: reserves or rotates the iCal token without committing the
  // user's toggle position. ical_enabled in the DB only flips on Save, so Cancel
  // after a first-time toggle leaves the integration disabled (the token may stay).
  function postTokenRequest(payload, callback) {
    Utils.xhr.post(window.warpGlobals.URLs['calendar'], payload, { toastOnSuccess: false, errorOnFailure: false })
      .then(function (result) {
        calToken = result.response.ical_token || null;
        updateCalEnabledUI();
        if (callback) callback(null, result.response);
      })
      .catch(function (err) {
        if (callback) callback(err);
      });
  }

  if (calCancelBtn) {
    calCancelBtn.addEventListener('click', function () {
      warpDialog(calModalEl).close();
    });
  }

  if (calEnabledEl) {
    calEnabledEl.addEventListener('change', function () {
      if (this.checked && !calToken) {
        postTokenRequest({ ensure_token: true }, function (err) {
          if (err) M.toast({ text: TR('Error saving calendar settings') });
        });
      } else {
        updateCalEnabledUI();
      }
    });
  }

  if (calUrlEyeBtn && calUrlInput && calUrlEye) {
    calUrlEyeBtn.addEventListener('click', function () {
      var isPassword = calUrlInput.type === 'password';
      calUrlInput.type = isPassword ? 'text' : 'password';
      calUrlEye.textContent = isPassword ? 'visibility_off' : 'visibility';
    });
  }

  if (calRegenBtn) {
    calRegenBtn.addEventListener('click', function () {
      if (!confirm(TR('Regenerating the URL will invalidate your current calendar subscription link. Continue?')))
        return;
      postTokenRequest({ ical_regenerate_token: true }, function (err) {
        if (err) {
          M.toast({ text: TR('Error regenerating URL') });
        } else {
          M.toast({ text: TR('Calendar URL regenerated') });
        }
      });
    });
  }

  if (calCopyBtn) {
    calCopyBtn.addEventListener('click', function () {
      var url = buildCalIcalUrl(calToken, selectedType);
      if (!url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          M.toast({ text: TR('URL copied to clipboard') });
        }).catch(function () {
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
    saveBtn.addEventListener('click', function () {
      if (!validateReminders()) return;

      var zones = calZonesEl
        ? Array.from(calZonesEl.options).filter(function (o) { return o.selected; }).map(function (o) { return parseInt(o.value); })
        : [];

      var payload = {
        ical_enabled: calEnabledEl ? !!calEnabledEl.checked : false,
        reminder_weekdays: weekdayMask,
        reminder_ahead_days: calMissingAheadEl ? parseInt(calMissingAheadEl.value) || 0 : 0,
        reminder_time: getTimepickerSeconds(),
        reminder_release_ahead_days: calReleaseAheadEl ? parseInt(calReleaseAheadEl.value) || 0 : 0,
        reminder_zones: zones
      };

      saveCalendar(payload, function (err) {
        if (err) {
          M.toast({ text: TR('Error saving calendar settings') });
        } else {
          M.toast({ text: TR('Calendar settings saved') });
          warpDialog(calModalEl).close();
        }
      });
    });
  }
}

export default initCalendar;
