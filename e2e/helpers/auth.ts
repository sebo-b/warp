import { Page, expect } from '@playwright/test';
import { TestUser } from './users';

/**
 * Log in through the UI form. Does not assert success — tests decide what
 * to expect (use `expectLoggedIn` for the happy path).
 */
export async function logIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Login').fill(user.login);
  await page.getByLabel('Password').fill(user.password);
  await page.locator('button[type=submit]').click();
}

/** Assert the browser ended up on a logged-in page (not /login). */
export async function expectLoggedIn(page: Page): Promise<void> {
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
  // #mobile-nav (the side navigation) only exists in the logged-in SPA shell (spa.html).
  await expect(page.locator('#mobile-nav')).toBeAttached();
}

export async function logOut(page: Page): Promise<void> {
  await page.goto('/logout');
  await page.waitForURL(/\/login$/);
}
