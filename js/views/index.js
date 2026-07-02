'use strict';

import html from './html/index.html';
import * as bootstrap from '../app/bootstrap.js';
import { matchRoute } from '../app/routes.js';

export { html };

export async function mount(ctx) {
  var use = ctx.root.querySelector('#index-logo-use');
  if (use) use.setAttribute('href', window.warpGlobals.URLs.logoSvg + '#wordmark');

  // Mirrors the old server-side "/" redirect (view.index): if the user has an
  // accessible default plan, go straight to it. Guarded by matchRoute so this
  // only fires once '/plan/:pid' is registered (WP7) — until then it's a no-op
  // and this trivial placeholder just stays mounted.
  var data = await bootstrap.get();
  if (data.defaultPlan != null &&
      data.plans.some(function (p) { return p.id === data.defaultPlan; }) &&
      matchRoute('/plan/' + data.defaultPlan)) {
    ctx.navigate('/plan/' + data.defaultPlan, { replace: true });
  }
}

export default { html, mount };
