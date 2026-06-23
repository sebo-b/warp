// One-off debug: boot sandbox, open the admin nav dropdown, dump the live DOM
// structure + computed styles to find why .dropdown-content { height:auto
// !important } isn't taking effect. Run: cd e2e && npx tsx ../res/visual-snapshot/debug-dropdown.ts
import { chromium } from '@playwright/test';
import { startSandbox, exposeToHelpers } from './container';
import { resetDb } from '../../e2e/helpers/db';
import { freezeClock } from './capture';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

async function main() {
  const sandbox = await startSandbox(false);
  exposeToHelpers(sandbox);
  await resetDb();
  await freezeClock(sandbox.baseURL);

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: sandbox.baseURL });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/zones', { waitUntil: 'load' });
  await page.locator('.dropdown-trigger[data-target="admin_menu_dropdown"]').click();
  await page.locator('#admin_menu_dropdown').waitFor({ state: 'visible' });
  await page.waitForTimeout(400); // let open animation settle

  const dump = await page.evaluate(() => {
    const out: any = {};
    const els = document.querySelectorAll('#admin_menu_dropdown');
    out.countById = els.length;
    const el = els[0] as HTMLElement;
    if (!el) return { error: 'no #admin_menu_dropdown' };
    const cs = getComputedStyle(el);
    out.className = el.className;
    out.inlineStyle = el.getAttribute('style');
    out.computed = { height: cs.height, maxHeight: cs.maxHeight, position: cs.position, top: cs.top, display: cs.display, opacity: cs.opacity, overflowY: cs.overflowY };
    out.rect = { top: Math.round(el.getBoundingClientRect().top), height: Math.round(el.getBoundingClientRect().height) };
    // ancestor chain
    const chain: string[] = [];
    let p: HTMLElement | null = el.parentElement;
    while (p && p.tagName !== 'HTML') { chain.push(p.tagName.toLowerCase() + (p.id ? '#' + p.id : '') + (p.className && typeof p.className === 'string' ? '.' + p.className.trim().split(/\s+/).join('.') : '')); p = p.parentElement; }
    out.ancestors = chain;
    // li breakdown
    const lis = Array.from(el.querySelectorAll(':scope > li')) as HTMLElement[];
    out.liCount = lis.length;
    out.lis = lis.map((li) => ({ cls: li.className, h: Math.round(li.getBoundingClientRect().height), minH: getComputedStyle(li).minHeight }));
    // first link color
    const a = el.querySelector('li > a') as HTMLElement | null;
    if (a) { const acs = getComputedStyle(a); out.firstLink = { text: a.textContent?.trim(), color: acs.color, display: acs.display }; }
    // Scan all stylesheet rules touching dropdown-content height (to see if
    // height:auto!important actually survived the build into the served CSS).
    out.heightRules = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList | null = null;
      try { rules = (sheet as CSSStyleSheet).cssRules; } catch { continue; }
      for (const r of Array.from(rules || [])) {
        const sr = r as CSSStyleRule;
        if (sr.selectorText && /dropdown-content|nav ul/.test(sr.selectorText) && sr.style && sr.style.height) {
          out.heightRules.push({ sel: sr.selectorText, height: sr.style.height, prio: sr.style.getPropertyPriority('height') });
        }
      }
    }
    out.inlineHeightPriority = el.style.getPropertyPriority('height');
    // which rule wins height? list matched maxHeight-ish ancestors with overflow
    return out;
  });

  console.log('=== ADMIN DROPDOWN LIVE DUMP ===');
  console.log(JSON.stringify(dump, null, 2));

  await browser.close();
  await sandbox.stop();
}

main().catch((e) => { console.error(e); process.exit(1); });
