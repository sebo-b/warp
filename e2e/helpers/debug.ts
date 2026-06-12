import type { Page } from '@playwright/test';

/** Shift utils.now() / utils.today() on the server by offsetSeconds.
 *  Requires the Flask debug blueprint (only active in DevelopmentSettings). */
export async function setTimeOffset(page: Page, offsetSeconds: number): Promise<void> {
  await page.request.post('/debug/set_time_offset', {
    data: { offset_seconds: offsetSeconds },
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Reset server time to real wall-clock time. */
export async function resetTimeOffset(page: Page): Promise<void> {
  await setTimeOffset(page, 0);
}

/** Return { now, today, offset_seconds } from the server's perspective. */
export async function getServerTime(page: Page): Promise<{ now: number; today: number; offset_seconds: number }> {
  const resp = await page.request.get('/debug/time');
  return resp.json();
}

/** Convenience: advance by N whole days. */
export async function advanceDays(page: Page, days: number): Promise<void> {
  await setTimeOffset(page, days * 86400);
}
