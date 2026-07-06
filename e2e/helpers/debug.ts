import type { Page } from '@playwright/test';

/** Shift utils.now() / utils.today() on the server by offsetSeconds.
 *  Requires the Flask debug blueprint (only active in DevelopmentSettings).
 *
 *  Beware: shifting the clock forward by a day or more expires every login
 *  session (SESSION_LIFETIME) — log in again after calling this. The pristineDb
 *  fixture resets the offset before each test, so no manual cleanup is needed. */
export async function setTimeOffset(page: Page, offsetSeconds: number): Promise<void> {
  const resp = await page.request.post('/debug/set_time_offset', {
    data: { offset_seconds: offsetSeconds },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok()) {
    throw new Error(`set_time_offset failed: HTTP ${resp.status()}`);
  }
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

/**
 * Switch the deployment fallback language (debug only). Sets DEFAULT_LANGUAGE
 * (the per-user resolver falls back to it when a user has no pref) and clears
 * the iCal feed cache so the feed regenerates in the new language. `lang` is a
 * short code ('de','en',...); reset between tests with 'en'.
 */
export async function setLanguage(page: Page, lang: string): Promise<void> {
  const resp = await page.request.post('/debug/set_language', {
    data: { language: lang },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!resp.ok()) {
    throw new Error(`set_language failed: HTTP ${resp.status()}`);
  }
}
