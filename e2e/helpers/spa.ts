import { Page, expect } from '@playwright/test';

/**
 * Wait for the SPA router to finish a view transition (app/router.js sets
 * document.body.dataset.view + dataset.viewReady and dispatches
 * 'warp:view-ready' at the end of every transition — see
 * PLAN_SPA_REFACTOR.md §2.2). Use this instead of waitForLoadState('networkidle')
 * for assertions that follow a client-side navigation (a nav-link click, a
 * Tabulator row action, ctx.navigate() from a saved form, …) — networkidle
 * only means something after a real page load.
 *
 * Pass `view` to also assert which view ended up mounted (its router.js name,
 * e.g. 'users', 'plan', 'error').
 */
export async function waitForViewReady(page: Page, view?: string): Promise<void> {
  await expect(page.locator('body[data-view-ready]')).toBeAttached();
  if (view !== undefined) {
    await expect(page.locator(`body[data-view="${view}"]`)).toBeAttached();
  }
}
