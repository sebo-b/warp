// Live height experiment on the admin dropdown. Reuses a running container via
// VISUAL_BASE_URL. Run: cd e2e && NODE_PATH="$(pwd)/node_modules" \
//   VISUAL_BASE_URL=http://127.0.0.1:PORT npx tsx ../res/visual-snapshot/live-experiment.ts
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
  await page.goto('/zones', { waitUntil: 'load' });
  await page.locator('.dropdown-trigger[data-target="admin_menu_dropdown"]').click();
  await page.locator('#admin_menu_dropdown').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const el = document.querySelector('#admin_menu_dropdown') as HTMLElement;
    const out: any = {};
    out.popoverAttr = el.getAttribute('popover');
    out.popoverOpen = el.matches(':popover-open');
    out.position = getComputedStyle(el).position;
    out.minHeight = getComputedStyle(el).minHeight;
    out.before = getComputedStyle(el).height;
    el.style.setProperty('height', 'auto', 'important');
    out.afterInlineAutoImportant = getComputedStyle(el).height;
    el.style.removeProperty('height');
    out.afterRemoveInline = getComputedStyle(el).height;   // stylesheet alone
    el.style.setProperty('height', 'fit-content', 'important');
    out.afterFitContent = getComputedStyle(el).height;
    el.style.removeProperty('height');
    out.scrollH = el.scrollHeight;
    return out;
  });
  console.log(JSON.stringify(r, null, 2));
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
