'use strict';

// Small entry for the server-rendered pages that stay outside the SPA
// (login.html, auth_error.html, ical_action.html): i18n .TR label handling,
// the outlined-field/placeholder setup and the theme toggle those pages'
// markup depends on — none of the modal/dialog/select/autocomplete machinery
// app/main.js ships for the logged-in shell.
import '@materializecss/materialize/dist/css/materialize.css';
import './style.css';
import Polyglot from 'node-polyglot';

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

if (!locale || !phrases)
  throw Error('locale and phrases must be defined');

window.warpGlobals.i18n.polyglot = new Polyglot({ locale: locale, phrases: phrases });

window.TR = window.warpGlobals.i18n.polyglot.t.bind(window.warpGlobals.i18n.polyglot);
window.TR.has = window.warpGlobals.i18n.polyglot.has.bind(window.warpGlobals.i18n.polyglot);

const trClass = 'TR';

window.TR.updateDOM = function () {
  for (let e of document.querySelectorAll('.' + trClass)) {
    let key = e.textContent.replace(/^\s*|\s*$/g, '').replace(/\s*\n\s*/g, ' ');
    e.textContent = window.warpGlobals.i18n.polyglot.t(key);
    e.classList.remove(trClass);
  }
};

function initThemeToggle() {
  document.addEventListener('click', function (ev) {
    var tg = ev.target.closest && ev.target.closest('.warp-theme-toggle');
    if (!tg) return;
    ev.preventDefault();
    var cur = document.documentElement.getAttribute('data-theme-choice') || 'auto';
    var order = ['light', 'dark', 'auto'];
    var next = order[(order.indexOf(cur) + 1) % order.length];
    if (window.warpThemeApply) window.warpThemeApply(next);
  });
}

// Hand-rolled language dropdown (mirrors initThemeToggle's delegated-click
// style). The public bundle ships no Materialize JS, so M.Dropdown is not an
// option here without bloating login/auth_error/ical/error pages.
function initLangDropdown() {
  var trigger = document.querySelector('.lang-trigger');
  if (!trigger) return;
  var menu = trigger.parentElement.querySelector('.lang-dropdown');
  if (!menu) return;

  function close() { menu.setAttribute('hidden', ''); }
  function open() { menu.removeAttribute('hidden'); }

  trigger.addEventListener('click', function (ev) {
    ev.preventDefault();
    if (menu.hasAttribute('hidden')) open(); else close();
  });

  // Selecting a language: set the cookie + reload only if it actually changed.
  menu.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-lang]');
    if (!a) return;
    ev.preventDefault();
    var code = a.getAttribute('data-lang');
    close();
    if (code === window.warpGlobals.lang) return;
    document.cookie = 'warp_lang=' + code + ';path=/;max-age=31536000;samesite=lax';
    window.location.reload();
  });

  // Close on outside click / Esc.
  document.addEventListener('click', function (ev) {
    if (!menu.hasAttribute('hidden') && !ev.target.closest('.lang-menu')) close();
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') close();
  });
}

document.addEventListener('DOMContentLoaded', function () {
  window.TR.updateDOM();
  document.querySelectorAll('.input-field input:not([placeholder]), .input-field textarea:not([placeholder])')
    .forEach(function (el) { el.setAttribute('placeholder', ' '); });
  document.querySelectorAll('.warp-fields .input-field:not(.chips)').forEach(function (el) {
    el.classList.add('outlined');
  });
  initThemeToggle();
  initLangDropdown();
});
