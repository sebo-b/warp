// Inspect the datepicker month-prev arrow: computed bg + matched background
// rules (CDP). Reuses a running container via VISUAL_BASE_URL.
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
    for (const inp of inputs) { if ((window as any).M?.Datepicker?.getInstance(inp)) { inp.focus(); inp.click(); return; } }
  });
  await page.locator('.datepicker-modal[open] .month-prev').first().waitFor({ state: 'attached' });

  const computed = await page.evaluate(() => {
    const el = document.querySelector('.datepicker-modal[open] .month-prev') as HTMLElement;
    const cs = getComputedStyle(el);
    const rc = el.getBoundingClientRect();
    return { tag: el.tagName, cls: el.className, html: el.outerHTML.slice(0, 160), bg: cs.backgroundColor, w: Math.round(rc.width), h: Math.round(rc.height), padL: cs.paddingLeft, padR: cs.paddingRight, hasSvg: !!el.querySelector('svg'), inner: el.innerHTML.slice(0, 120) };
  });
  console.log('COMPUTED:', JSON.stringify(computed, null, 2));

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.datepicker-modal[open] .month-prev' });
  const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });
  console.log('\nMATCHED background-color (cascade order):');
  for (const m of matched.matchedCSSRules || []) {
    const b = (m.rule.style?.cssProperties || []).find((p) => p.name === 'background-color' || p.name === 'background');
    if (b) console.log(`  ${m.rule.selectorList.text}  ->  ${b.name}:${b.value}${(b as any).important ? ' !important' : ''}`);
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
