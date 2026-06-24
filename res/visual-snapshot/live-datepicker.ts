// Live datepicker check on /bookings (real header-filter input). Reuses a
// running container via VISUAL_BASE_URL. Confirms the modal actually shows
// on-screen (opacity/position) and that selecting a day updates the input.
import { chromium } from '@playwright/test';
import { startSandbox } from './container';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

async function main() {
  const sandbox = await startSandbox(false);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: sandbox.baseURL });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/bookings', { waitUntil: 'load' });
  await page.locator('.tabulator-header-filter input').first().waitFor({ state: 'attached' });

  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.tabulator-header-filter input')) as HTMLElement[];
    for (const inp of inputs) {
      if ((window as any).M?.Datepicker?.getInstance(inp)) { (window as any).__dpInput = inp; inp.scrollIntoView({ block: 'center' }); inp.focus(); inp.click(); return; }
    }
    throw new Error('no datepicker input');
  });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const out: any = {};
    const m = document.querySelector('.datepicker-modal[open]') as HTMLElement | null;
    out.modalOpenExists = !!m;
    if (m) {
      const cs = getComputedStyle(m);
      const rc = m.getBoundingClientRect();
      out.opacity = cs.opacity;
      out.display = cs.display;
      out.position = cs.position;
      out.rect = { top: Math.round(rc.top), left: Math.round(rc.left), w: Math.round(rc.width), h: Math.round(rc.height) };
      out.onScreen = rc.top < window.innerHeight && rc.bottom > 0 && rc.left < window.innerWidth && rc.right > 0;
      out.dayButtons = m.querySelectorAll('.datepicker-day-button').length;
    }
    // verify the proposed CSS fix: pin to viewport centre
    if (m) {
      m.style.position = 'fixed'; m.style.inset = '0'; m.style.margin = 'auto';
      const rc2 = m.getBoundingClientRect();
      out.afterFix_rect = { top: Math.round(rc2.top), left: Math.round(rc2.left), w: Math.round(rc2.width), h: Math.round(rc2.height) };
      out.afterFix_onScreen = rc2.top < window.innerHeight && rc2.bottom > 0 && rc2.left < window.innerWidth && rc2.right > 0;
    }
    // select a day + Done, read input value
    const btns = Array.from(document.querySelectorAll('.datepicker-modal .datepicker-day-button:not(.is-disabled)')) as HTMLElement[];
    const pick = btns.find((b) => b.textContent?.trim() === '15') ?? btns[10];
    if (pick) pick.click();
    const done = document.querySelector('.datepicker-modal .datepicker-done') as HTMLElement | null;
    if (done) done.click();
    out.inputValueAfterPick = (window as any).__dpInput?.value ?? null;
    out.modalStillOpenAfter = !!document.querySelector('.datepicker-modal[open]');
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
