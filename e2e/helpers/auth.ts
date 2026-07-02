import { Page, expect } from '@playwright/test';
import { TestUser } from './users';
import { waitForViewReady } from './spa';

/**
 * Log in through the UI form. Does not assert success — tests decide what
 * to expect (use `expectLoggedIn` for the happy path). Stays neutral so a
 * wrong-password test can still assert it landed back on /login.
 */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Login').fill(user.login);
  await page.getByLabel('Password').fill(user.password);
  await page.locator('button[type=submit]').click();
}

/** Assert the browser ended up on a logged-in page (not /login) AND the SPA
 *  shell has finished booting.
 *
 *  #mobile-nav is in spa.html's static markup, so it's attached at first paint
 *  — BEFORE boot()'s async i18n/bootstrap fetch + initDropdowns() run. A caller
 *  that clicks a shell .dropdown-trigger immediately after this would race
 *  initDropdowns and the click would do nothing. Waiting for the first view
 *  transition (body[data-view-ready], set at the end of boot) guarantees the
 *  dropdowns are wired up. */
export async function expectLoggedIn(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  // #mobile-nav (the side navigation) only exists in the logged-in SPA shell (spa.html).
  await expect(page.locator('#mobile-nav')).toBeAttached();
  await waitForViewReady(page);
}

export async function logOut(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL(/\/login$/);
}