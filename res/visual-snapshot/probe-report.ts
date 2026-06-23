import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\nSTACK:\n' + (e.stack || '')));
  page.on('requestfailed', (r) => errors.push('REQFAIL: ' + r.url() + ' ' + (r.failure()?.errorText)));
  const responses: string[] = [];
  const requests: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/xhr/bookings/report')) {
      requests.push('REQ ' + (r.postData() || '').slice(0, 500));
    }
  });
  page.on('response', async (r) => {
    if (r.url().includes('/xhr/bookings/report')) {
      let body = '';
      try { body = (await r.text()).slice(0, 300); } catch {}
      responses.push(`RESP ${r.status()} :: ${body}`);
    }
  });

  await logIn(page, ADMIN);
  await page.goto('/bookings/report', { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  const headers = await page.$$eval('#reportTable .tabulator-col-title', (els) => els.map((e) => e.textContent));
  const rowCount = await page.$$eval('#reportTable .tabulator-row', (els) => els.length);

  console.log('HEADERS:', JSON.stringify(headers));
  console.log('ROW COUNT:', rowCount);
  console.log('--- errors/requests/responses ---');
  for (const e of errors) console.log(e);
  for (const r of requests) console.log(r);
  for (const r of responses) console.log(r);

  // Now click a column header to reproduce the sort error
  errors.length = 0;
  try {
    await page.click('#reportTable .tabulator-col-title >> text=User name', { timeout: 3000 });
    await page.waitForTimeout(1500);
  } catch (e) { console.log('click failed', String(e)); }
  console.log('--- after header click ---');
  for (const e of errors) console.log(e);
  console.log('ALL REQUESTS:');
  for (const r of requests) console.log(r);
  for (const r of responses) console.log(r);

  await browser.close();
})();
