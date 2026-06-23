// Probe the pref modal FormSelect dropdown when OPEN — check position,
// computed display, and whether it escapes the dialog bounds.
// Run: cd e2e && NODE_PATH="$(pwd)/node_modules" npx tsx ../res/visual-snapshot/inspect-pref-select.ts
import { chromium } from '@playwright/test';
import { startSandbox } from './container';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

async function main() {
  const sandbox = await startSandbox(true);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: sandbox.baseURL });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/', { waitUntil: 'load' });
  await page.locator('.dropdown-trigger[data-target="user_menu_dropdown"]').click();
  await page.locator('#user_menu_dropdown').waitFor({ state: 'visible' });
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /preferences/i }).click();
  await page.locator('#pref_modal').waitFor({ state: 'visible' });

  // Open the first FormSelect dropdown inside the modal.
  await page.locator('#pref_modal .select-wrapper input').first().click();
  await page.locator('.dropdown-content.select-dropdown').first().waitFor({ state: 'visible' });
  await page.waitForTimeout(200);

  const r = await page.evaluate(() => {
    const plan = document.getElementById('pref_default_plan') as HTMLSelectElement | null;
    const wrap = (plan?.closest('.select-wrapper') as HTMLElement | null) || null;
    const ul = (wrap?.querySelector('ul.dropdown-content') as HTMLElement | null) || null;
    const input = (wrap?.querySelector('input.select-dropdown') as HTMLElement | null) || null;
    const dlg = document.getElementById('pref_modal') as HTMLElement | null;
    return {
      dlgRect: dlg && { top: dlg.getBoundingClientRect().top, bottom: dlg.getBoundingClientRect().bottom, left: dlg.getBoundingClientRect().left, right: dlg.getBoundingClientRect().right },
      inputRect: input && { top: input.getBoundingClientRect().top, bottom: input.getBoundingClientRect().bottom, left: input.getBoundingClientRect().left, right: input.getBoundingClientRect().right },
      ul: ul && {
        id: ul.id, cls: ul.className,
        display: getComputedStyle(ul).display,
        position: getComputedStyle(ul).position,
        zIndex: getComputedStyle(ul).zIndex,
        top: getComputedStyle(ul).top,
        left: getComputedStyle(ul).left,
        rect: { top: ul.getBoundingClientRect().top, bottom: ul.getBoundingClientRect().bottom, left: ul.getBoundingClientRect().left, right: ul.getBoundingClientRect().right, w: ul.getBoundingClientRect().width, h: ul.getBoundingClientRect().height },
        inTopLayer: (() => { try { return ul.matches(':popover-open'); } catch { return null; } })(),
      },
    };
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
  await sandbox.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
