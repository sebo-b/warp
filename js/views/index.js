'use strict';

import html from './html/index.html';
import * as bootstrap from '../app/bootstrap.js';

export { html };

export async function mount(ctx) {
  var use = ctx.root.querySelector('#index-logo-use');
  if (use) use.setAttribute('href', window.warpGlobals.URLs.logoSvg + '#wordmark');

  // Mirrors the old server-side "/" redirect (view.index): if the user has an
  // accessible default plan, go straight to it. data.plans is the accessible
  // set from /xhr/bootstrap, so the `some` check both guards against a deleted
  // default plan and against an inaccessible one (it wouldn't be in the list).
  // One-time navigate({replace:true}) — no loop risk: if the target is
  // inaccessible the plan view's getContext 403 renders the client error view.
  var data = await bootstrap.get();
  if (data.defaultPlan != null &&
      data.plans.some(function (p) { return p.id === data.defaultPlan; })) {
    ctx.navigate(window.warpGlobals.URLs['plan'].replace('__PID__', data.defaultPlan), { replace: true });
  }
}

export default { html, mount };