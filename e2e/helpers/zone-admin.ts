import type { Page } from '@playwright/test';

/**
 * Check the first date checkbox on the zone page and return its timestamp.
 * On desktop (1280px) the side panel is always visible — no trigger click needed.
 */
export async function pickFirstDate(page: Page): Promise<number> {
  const first = page.locator('.date_checkbox').first();
  const ts = Number(await first.inputValue());
  await first.check({ force: true });
  return ts;
}
