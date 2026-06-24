import { chromium } from '@playwright/test';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await page.goto('/login', { waitUntil: 'networkidle' });
  await page.fill('#login', 'someuser');
  await page.fill('#password', 'secret');
  await page.waitForTimeout(300);
  const info = await page.evaluate(() => {
    const out: string[] = [];
    for (const id of ['login', 'password']) {
      const input = document.getElementById(id) as HTMLInputElement;
      const label = document.querySelector('label[for="' + id + '"]') as HTMLElement;
      const ir = input.getBoundingClientRect();
      const lr = label.getBoundingClientRect();
      // floated label sits ABOVE the input's vertical centre (near/above its top edge)
      out.push(id + ': floated=' + (lr.top < ir.top + 4) + ' labelTop=' + Math.round(lr.top) + ' inputTop=' + Math.round(ir.top));
    }
    return out.join('\n');
  });
  console.log(info);
  await page.screenshot({ path: '/tmp/login_filled.png' });
  await browser.close();
})();
