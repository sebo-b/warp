import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const W = parseInt(process.env.PROBE_W || '940');
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: W, height: 760 } });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/plan/1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(1000);
  await page.locator('#zonemap div[style*="background-image"]').first().click();
  await page.locator('#action_modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/seat_probe.png' });

  const info = await page.evaluate(() => {
    const out: string[] = [];
    const mc = document.querySelector('#action_modal .modal-content') as HTMLElement;
    const row = document.querySelector('#action_modal .row') as HTMLElement;
    const btns = document.querySelector('#action_modal .action_modal_buttons') as HTMLElement;
    const msg1 = document.getElementById('action_modal_msg1');
    out.push('modal-content display=' + (mc && getComputedStyle(mc).display));
    out.push('row display=' + (row && getComputedStyle(row).display));
    out.push('buttons-is-child-of-row=' + !!(row && btns && row.contains(btns)));
    if (msg1) { const r = msg1.getBoundingClientRect(); out.push('msg1 rect y=' + Math.round(r.y) + ' h=' + Math.round(r.height)); }
    if (btns) { const r = btns.getBoundingClientRect(); const cs = getComputedStyle(btns); out.push('buttons rect y=' + Math.round(r.y) + ' x=' + Math.round(r.x) + ' w=' + Math.round(r.width) + ' display=' + cs.display + ' float=' + cs.float); }
    out.push('modal-content HTML: ' + (mc ? mc.innerHTML.replace(/\s+/g, ' ').slice(0, 700) : 'NONE'));
    return out.join('\n');
  });
  console.log(info);
  await browser.close();
})();
