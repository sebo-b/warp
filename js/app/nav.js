'use strict';

import * as bootstrap from './bootstrap.js';

// Builds the "Bookings" + accessible-plan links in the desktop nav and the
// #mobile-nav sidenav from /xhr/bootstrap (replaces the old server-rendered
// headerDataL loop). #nav-left-dynamic is itself a <ul>, so injecting <li>s via
// innerHTML is safe; #mobile-nav-dynamic is a <template> marker inside the
// <ul class="sidenav"> shell (a wrapper <li> can't safely hold nested <li>
// children) — dynamic items are inserted as its following siblings and tagged
// so a re-render can find and remove them.

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function itemsHTML(data) {
  if (!data.plans || !data.plans.length) return '';
  var html = '<li><a href="/bookings" class="nav-plan-link TR">Bookings</a></li>';
  data.plans.forEach(function (p) {
    html += '<li><a href="/plan/' + p.id + '" class="nav-plan-link">' + escapeHtml(p.name) + '</a></li>';
  });
  return html;
}

export function render() {
  return bootstrap.get().then(function (data) {
    var html = itemsHTML(data);

    var desktop = document.getElementById('nav-left-dynamic');
    if (desktop) desktop.innerHTML = html;

    var marker = document.getElementById('mobile-nav-dynamic');
    if (marker) {
      marker.parentNode.querySelectorAll('.nav-dynamic-item').forEach(function (el) { el.remove(); });
      if (html) {
        var wrap = document.createElement('template');
        wrap.innerHTML = html;
        wrap.content.querySelectorAll('li').forEach(function (li) { li.classList.add('nav-dynamic-item'); });
        marker.after(wrap.content);
      }
    }

    if (window.TR) {
      // The dynamic links (.TR -> visibility:hidden until translated) were
      // injected AFTER the boot TR.updateDOM() pass, so translate both the
      // desktop nav and the mobile sidenav now — otherwise the desktop
      // "Bookings" link renders invisible.
      if (desktop) window.TR.updateDOM(desktop);
      var mobileNavEl = document.getElementById('mobile-nav');
      if (mobileNavEl) window.TR.updateDOM(mobileNavEl);
    }
    setActive();
  });
}

export function setActive() {
  var path = window.location.pathname;
  document.querySelectorAll('.nav-plan-link').forEach(function (a) {
    var li = a.closest('li');
    if (li) li.classList.toggle('active', a.getAttribute('href') === path);
  });
}
