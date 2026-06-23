import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/', { waitUntil: 'networkidle' });

  // open calendar modal
  await page.click('a.dropdown-trigger[data-target="user_menu_dropdown"]');
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /calendar integration/i }).click();
  await page.locator('#calendar_modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(600);

  // enable integration so reminder section is active (click the visible lever)
  await page.locator('#cal_enabled ~ .lever').click({ force: true });
  await page.waitForTimeout(400);
  // configure a reminder so the shared (zones/weekday/time) section enables
  await page.selectOption('#cal_missing_ahead', '1').catch((e) => console.log('selectOption err', String(e)));
  await page.evaluate(() => {
    const el = document.getElementById('cal_missing_ahead');
    if (el) el.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForTimeout(500);

  // open the "Zones to monitor" multiselect dropdown
  const zonesWrap = page.locator('#cal_shared_section .select-wrapper input.select-dropdown').first();
  await zonesWrap.scrollIntoViewIfNeeded();
  await zonesWrap.click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: '/tmp/cal_zones_dropdown.png' });
  console.log('captured zones dropdown');

  // close dropdown, open timepicker
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const timeInput = page.locator('#cal_time_input');
  await timeInput.scrollIntoViewIfNeeded();
  await timeInput.click();
  await page.waitForTimeout(700);
  await page.screenshot({ path: '/tmp/cal_timepicker.png' });
  console.log('captured timepicker');

  const tpInfo = await page.evaluate(() => {
    const disp = document.querySelector('.timepicker-digital-display');
    const out: string[] = [];
    out.push(disp ? disp.outerHTML.replace(/\s+/g, ' ').slice(0, 1000) : 'NONE');
    for (const sel of ['.timepicker-span-hours', '.timepicker-span-minutes', '.timepicker-input-hours', '.timepicker-input-minutes']) {
      const el = document.querySelector(sel) as HTMLInputElement | null;
      if (!el) { out.push(sel + ': MISSING'); continue; }
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      out.push(sel + ': text="' + (el.value || el.textContent?.trim()) + '" color=' + cs.color + ' bg=' + cs.backgroundColor +
        ' opacity=' + cs.opacity + ' fontSize=' + cs.fontSize + ' rect=' + Math.round(r.x) + ',' + Math.round(r.y) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) +
        ' visibility=' + cs.visibility + ' textIndent=' + cs.textIndent);
    }
    return out.join('\n');
  });
  console.log('TIMEPICKER DOM:\n' + tpInfo);

  await browser.close();
})();
