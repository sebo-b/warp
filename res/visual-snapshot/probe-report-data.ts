import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/bookings/report', { waitUntil: 'networkidle' });
  // Query with a very wide date window to prove rows come through when in range.
  const res = await page.evaluate(async () => {
    const r = await fetch('/xhr/bookings/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        page: 1, size: 10, sort: [],
        filter: [
          { field: 'fromTS', type: '>=', value: 0 },
          { field: 'toTS', type: '<=', value: 4102444800 }, // year 2100
        ],
      }),
    });
    return { status: r.status, body: await r.text() };
  });
  console.log('STATUS', res.status);
  console.log('BODY', res.body.slice(0, 600));
  await browser.close();
})();
