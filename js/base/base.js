'use strict';

import './style.css';
import 'nouislider/dist/nouislider.css';
import Polyglot from 'node-polyglot';
import noUiSlider from 'nouislider';

if (typeof(window?.warpGlobals?.i18n) !== 'object')
  throw Error('warpGlobals.i18n must be defined');

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

function initPrefs() {
  var prefModalEl = document.getElementById('pref_modal');
  var zoneSelectEl = document.getElementById('pref_default_zone');
  var daySelectEl = document.getElementById('pref_default_day');
  var saveBtn = document.getElementById('pref_save_btn');
  var sliderEl = document.getElementById('pref_timeslider');
  var minDiv = document.getElementById('pref_timeslider-min');
  var maxDiv = document.getElementById('pref_timeslider-max');
  var icalToggle = document.getElementById('pref_ical_enabled');
  var icalUrlRow = document.getElementById('ical_url_row');
  var icalUrlInput = document.getElementById('pref_ical_url');
  var icalCopyBtn = document.getElementById('pref_ical_copy');
  var icalRegenBtn = document.getElementById('pref_ical_regenerate');

  if (!prefModalEl || !zoneSelectEl || !daySelectEl || !saveBtn || !sliderEl)
    return;

  var DEFAULT_TIME = [9 * 3600, 17 * 3600];
  var loadedPrefs = null;
  var slider = null;
  var icalEnabled = false;
  var icalToken = null;

  function buildIcalUrl(token) {
    if (!token) return '';
    return window.location.protocol + '//' + window.location.host + '/ical/' + token + '.ics';
  }

  function updateIcalUI() {
    if (!icalUrlRow || !icalUrlInput) return;
    if (icalEnabled && icalToken) {
      icalUrlRow.style.display = '';
      icalUrlInput.value = buildIcalUrl(icalToken);
      M.updateTextFields();
    } else {
      icalUrlRow.style.display = 'none';
    }
  }

  function formatHHMM(seconds) {
    if (seconds >= 24 * 3600) return "23:59";
    return new Date(seconds * 1000).toISOString().substring(11, 16);
  }

  function applyPrefsToUI() {
    var time = (loadedPrefs && loadedPrefs.default_time) ? loadedPrefs.default_time : DEFAULT_TIME;
    zoneSelectEl.value = (loadedPrefs && loadedPrefs.default_zone) ? String(loadedPrefs.default_zone) : "";
    daySelectEl.value = (loadedPrefs && loadedPrefs.default_day) ? loadedPrefs.default_day : "same";
    M.FormSelect.init(zoneSelectEl);
    M.FormSelect.init(daySelectEl);
    if (slider) slider.set(time);

    icalEnabled = loadedPrefs ? !!loadedPrefs.ical_enabled : false;
    icalToken = loadedPrefs ? loadedPrefs.ical_token || null : null;
    if (icalToggle) icalToggle.checked = icalEnabled;
    updateIcalUI();
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

  M.FormSelect.init(zoneSelectEl);
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
      default_zone: zoneSelectEl.value || undefined,
      default_day: daySelectEl.value,
      default_time: slider.get(true).map(function(v) { return Math.round(v); })
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
      if (callback) callback(null, prefs);
    })
    .catch(function(err) {
      if (callback) callback(err);
    });
  }

  saveBtn.addEventListener('click', function() {
    postPrefs({ ical_enabled: icalToggle ? icalToggle.checked : false }, function(err) {
      if (err) {
        M.toast({ text: TR('Error saving preferences') });
      } else {
        M.toast({ text: TR('Preferences saved') });
      }
    });
  });

  if (icalToggle) {
    icalToggle.addEventListener('change', function() {
      icalEnabled = this.checked;
      if (icalEnabled && !icalToken) {
        postPrefs({ ical_enabled: true }, function(err) {
          if (err) M.toast({ text: TR('Error saving preferences') });
        });
      } else {
        updateIcalUI();
      }
    });
  }

  if (icalRegenBtn) {
    icalRegenBtn.addEventListener('click', function() {
      if (!confirm(TR('Regenerating the URL will invalidate your current calendar subscription link. Continue?')))
        return;
      postPrefs({ ical_regenerate_token: true }, function(err) {
        if (err) {
          M.toast({ text: TR('Error regenerating URL') });
        } else {
          M.toast({ text: TR('Calendar URL regenerated') });
        }
      });
    });
  }

  if (icalCopyBtn && icalUrlInput) {
    icalCopyBtn.addEventListener('click', function() {
      var url = icalUrlInput.value;
      if (!url) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          M.toast({ text: TR('URL copied to clipboard') });
        }).catch(function() {
          M.toast({ text: TR('Failed to copy') });
        });
      } else {
        icalUrlInput.select();
        icalUrlInput.setSelectionRange(0, 99999);
        document.execCommand('copy');
        M.toast({ text: TR('URL copied to clipboard') });
      }
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
      M.toast({ text: TR('All fields are required') });
      return;
    }

    if (newPassword.length < minLen) {
      M.toast({ text: TR('Password must be at least %{n} characters', { n: minLen }) });
      return;
    }

    if (newPassword !== repeatPassword) {
      M.toast({ text: TR('Passwords do not match') });
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

  let pendingToast = window.sessionStorage.getItem('pendingToast');
  if (pendingToast) {
    window.sessionStorage.removeItem('pendingToast');
    M.toast({text: pendingToast});
  }

  initDropdowns();
  initPrefs();
  initChangePassword();
});
