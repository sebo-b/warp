import type { Page } from '@playwright/test';

/**
 * Ensure the first selectable calendar day is selected, return its timestamp.
 * The calendar grid exposes selectable days as .warp-cal-day cells with data-ts;
 * the first selectable one is today, pre-selected on load. A plain click is a
 * TOGGLE, so this only clicks when the day isn't already selected (avoids
 * accidentally deselecting the default-day and leaving no dates selected).
 */
export async function pickFirstDate(page: Page): Promise<number> {
  const cell = page.locator('.warp-cal-day[data-ts]:not(.is-disabled)').first();
  const ts = Number(await cell.getAttribute('data-ts'));
  if (!await cell.evaluate(el => el.classList.contains('is-selected')))
    await cell.click();
  return ts;
}
