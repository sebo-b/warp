/**
 * Mobile sidenav regressions from the SPA refactor.
 *
 * Pre-SPA, both behaviors came for free: every nav click was a full page
 * load (so the open sidenav vanished with the old document), and the base
 * template initialized the collapsible accordions. Under the SPA shell the
 * sidenav is persistent markup — it must be closed explicitly on selection
 * (app/triggers.js) and its .collapsible groups need an explicit
 * M.Collapsible init (app/main.js), since Materialize 2.x has no auto-init.
 *
 * NB: Materialize folds collapsible bodies with `max-height:0px; overflow:
 * hidden` — the links inside keep a bounding box, so Playwright's
 * toBeVisible() would still report them "visible" when folded. Assert on the
 * body's clientHeight instead (0 when folded, >0 when expanded).
 */
import { test, expect } from '../fixtures';
import { logIn } from '../helpers/auth';
import { ADMIN } from '../helpers/users';
import { waitForViewReady } from '../helpers/spa';

test.use({ viewport: { width: 400, height: 800 } });

// The admin group: the collapsible <li> whose header reads exactly "Admin"
// ("admin" — the login — heads the second group).
function adminGroup(page: import('@playwright/test').Page) {
  return page.locator('#mobile-nav .collapsible > li')
    .filter({ has: page.getByText('Admin', { exact: true }) });
}

test.describe('mobile sidenav', () => {

  test('folded admin group unfolds on click', async ({ page }) => {
    await logIn(page, ADMIN);
    await waitForViewReady(page);

    await page.locator('.sidenav-trigger').click();
    await expect(page.locator('#mobile-nav')).toBeInViewport();

    const body = adminGroup(page).locator('.collapsible-body');
    await expect(body).toHaveJSProperty('clientHeight', 0);

    // Regression: without M.Collapsible.init the header click did nothing
    // and the group stayed folded forever.
    await adminGroup(page).locator('.collapsible-header').click();
    await expect
      .poll(() => body.evaluate((el) => el.clientHeight))
      .toBeGreaterThan(0);

    // The header toggles its own submenu — it must NOT close the sidenav.
    await expect(page.locator('#mobile-nav')).toBeInViewport();
  });

  test('sidenav closes when a destination is selected', async ({ page }) => {
    await logIn(page, ADMIN);
    await waitForViewReady(page);

    await page.locator('.sidenav-trigger').click();
    await expect(page.locator('#mobile-nav')).toBeInViewport();
    await adminGroup(page).locator('.collapsible-header').click();

    // Regression: the SPA router swaps only #view-root, so without an
    // explicit close the sidenav stayed open covering the new view.
    await adminGroup(page).locator('a', { hasText: 'Users' }).click();
    await waitForViewReady(page, 'users');
    await expect(page.locator('#mobile-nav')).not.toBeInViewport();
  });

});
