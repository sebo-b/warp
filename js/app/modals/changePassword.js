'use strict';

import { M } from '../materialize.js';
import warpDialog from '../dialog.js';

export function initChangePassword() {
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

  var cpModal = warpDialog(cpModalEl, {
    onCloseEnd: clearFields
  });

  saveBtn.addEventListener('click', function () {
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
      .then(function (r) {
        if (!r.ok) return r.json().then(function (e) { throw e; });
        return r.json();
      })
      .then(function () {
        cpModal.close();
        M.toast({ text: TR('Password changed successfully') });
      })
      .catch(function (err) {
        M.toast({ text: err.msg || TR('Error changing password') });
      });
  });
}

export default initChangePassword;
