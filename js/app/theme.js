'use strict';

// Top-bar light/dark/auto toggle. Cycles light → dark → auto → light and
// delegates to window.warpThemeApply (defined by the inline pre-paint script in
// base.html), which owns the cookie, the <html> attributes, and live
// prefers-color-scheme following. This only handles the in-page click. Delegated
// so it needs no per-page wiring (and survives view mounts/unmounts).
export function initThemeToggle() {
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
