// Definitive height-cascade inspector for the admin nav dropdown, via CDP
// getMatchedStylesForNode. Reuses a running container: set VISUAL_BASE_URL.
// Run: cd e2e && NODE_PATH="$(pwd)/node_modules" VISUAL_BASE_URL=http://127.0.0.1:PORT \
//        npx tsx ../res/visual-snapshot/inspect-cascade.ts
import { chromium } from '@playwright/test';
import { startSandbox } from './container';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

async function main() {
  const sandbox = await startSandbox(false); // no-op when VISUAL_BASE_URL is set
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, baseURL: sandbox.baseURL });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/zones', { waitUntil: 'load' });
  await page.locator('.dropdown-trigger[data-target="admin_menu_dropdown"]').click();
  await page.locator('#admin_menu_dropdown').waitFor({ state: 'visible' });
  await page.waitForTimeout(300);

  const cdp = await ctx.newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '#admin_menu_dropdown' });
  const matched = await cdp.send('CSS.getMatchedStylesForNode', { nodeId });

  // inline
  const inlineH = (matched.inlineStyle?.cssProperties || []).find((p) => p.name === 'height');
  console.log('INLINE height:', inlineH ? `${inlineH.value} important=${(inlineH as any).important ?? false}` : '(none)');

  // matched rules, in CDP order (least→most specific); print any with `height`
  console.log('\nMATCHED height declarations (cascade order):');
  for (const m of matched.matchedCSSRules || []) {
    const h = (m.rule.style?.cssProperties || []).find((p) => p.name === 'height');
    if (h) {
      console.log(`  ${m.rule.selectorList.text}  ->  height:${h.value}${(h as any).important ? ' !important' : ''}  [active=${(h as any).disabled !== true}]`);
    }
  }
  await browser.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
