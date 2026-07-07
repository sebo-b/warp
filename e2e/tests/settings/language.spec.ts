/**
 * Per-user language selection (see PLAN_language_selection.md).
 *
 * Coverage:
 *  - login screen flag dropdown: switching reloads + renders in the chosen
 *    language (assert a translated string); the warp_lang cookie is set;
 *    clicking the already-active flag does NOT reload (bounded negative).
 *  - Preferences: a Language row listing each offered language (no Default
 *    entry — a NULL pref shows the deployment default applied, not selectable);
 *    selecting a language and saving reloads + persists (DB backchannel);
 *    picking the deployment-default language pins it; saving with no language
 *    change keeps the pref NULL (the default keeps applying).
 *  - precedence (shared device): a seeded user pref beats a stale cookie, and
 *    bootstrap resets the cookie to the pref.
 *  - default: no cookie + NULL pref renders the deployment default (en).
 *
 * The container runs with WARP_LANGUAGES='["en","de"]' (global-setup.ts).
 */

import { test, expect } from '../../fixtures';
import { logIn, expectLoggedIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { openUserMenu } from '../../helpers/settings';
import { waitForViewReady } from '../../helpers/spa';
import { getRuntimeInfo } from '../../helpers/runtime';

type Page = import('@playwright/test').Page;

async function clearUserPrefs(login: string): Promise<void> {
  await querySql('DELETE FROM user_prefs WHERE login = $1', [login]);
}

async function seedUserPref(login: string, language: string | null): Promise<void> {
  await querySql(
    'INSERT INTO user_prefs(login, language) VALUES($1,$2) ON CONFLICT(login) DO UPDATE SET language = $2',
    [login, language],
  );
}

async function prefLanguage(login: string): Promise<string | null> {
  const rows = await querySql('SELECT language FROM user_prefs WHERE login = $1', [login]);
  return rows.rowCount ? rows.rows[0].language : null;
}

// ─── Login screen dropdown ────────────────────────────────────────────────

test.describe('login screen language dropdown', () => {

  test('switching language reloads and renders the login button translated', async ({ page, context }) => {
    await clearUserPrefs(USER1.login);
    await page.goto('/login');
    await expect(page.locator('.lang-trigger')).toBeVisible();

    // Default is English: the submit button reads "Login".
    await expect(page.locator('button[type=submit]')).toHaveText('Login');

    // Pick German from the dropdown.
    await page.locator('.lang-trigger').click();
    await page.locator('.lang-dropdown a[data-lang="de"]').click();

    // The click sets the cookie and reloads; after reload the button is German.
    await expect(page.locator('button[type=submit]')).toHaveText('Anmelden');
    const cookies = await context.cookies();
    expect(cookies.find(c => c.name === 'warp_lang')?.value).toBe('de');
  });

  test('clicking the already-active flag does not reload', async ({ page }) => {
    await page.goto('/login');
    await page.locator('.lang-trigger').click();
    // English is active by default; clicking it must not navigate.
    const navigations: number[] = [];
    page.on('framenavigated', () => navigations.push(Date.now()));
    await page.locator('.lang-dropdown a[data-lang="en"]').click();
    // Bounded wait: if no navigation fires within 1s, the negative holds.
    await page.waitForTimeout(1000);
    expect(navigations.length, 'no reload expected when choosing the active language').toBe(0);
  });
});

// ─── Preferences modal ────────────────────────────────────────────────────

async function openPrefs(page: Page): Promise<void> {
  // Await THIS page's /xhr/prefs GET (the prefs modal JS resolves its Promise:
  //   - loads `loadedPrefs`, unblocking postPrefs()'s loadedPrefs===null guard
  //     (without this, save is a no-op → 'de' never POSTed → DB stays null);
  //   - runs applyPrefsToUI()/setLangUI(), which OVERWRITES an in-progress
  //     selection — clicking 'de' before the GET resolves is reverted to null.
  // Waiting on .pref-lang-name alone is NOT enough: setLangUI(null) fills it
  // from the default option at modal open, before the GET resolves.
  // The listener MUST be registered BEFORE page.goto returns settling — under
  // load, the GET completes while page.goto() is still awaiting 'load', so an
  // after-goto listener misses it (logged in only this test, when it runs
  // right after ical-language.spec.ts). Registered before navigation, it
  // captures this boot's GET; the prior page's in-flight GET was aborted by
  // the navigation and never fires 'response'.
  const prefsLoaded = page.waitForResponse(
    r => r.url().includes('/xhr/prefs') && r.request().method() === 'GET',
  );
  await page.goto('/');
  await openUserMenu(page);
  // Open by href, not translated text: this spec seeds/switches non-English
  // languages, so the link reads e.g. "Einstellungen", not "Preferences".
  await page.locator('#user_menu_dropdown a[href="#pref_modal"]').click();
  await expect(page.locator('#pref_modal')).toBeVisible();
  await prefsLoaded;
}

// The prefs Language control is an M.Dropdown (flag+name list), not a
// native <select>: open it via the trigger, then click the item.
async function selectPrefLang(page: Page, code: string): Promise<void> {
  await page.locator('.pref-lang-trigger').click();
  await page.locator(`.pref-lang-dropdown a[data-lang="${code}"]`).click();
}

// Click Save on the prefs modal and await the resulting reload. Only a real
// language change reloads (prefs.js compares newLang !== prevLang), so this
// MUST be used wherever the test expects persistence across the reload.
//
// Await the POST RESPONSE first: the client only reloads inside its .then()
// (after the server committed the upsert), so awaiting the 200 POST both gates
// persistence and places us before the reload. A pre-armed waitForURL is
// unsafe — it can resolve on a leftover 'commit' and return before the POST
// flushes, and the then-triggered reload aborts the POST (status -1, 'de'
// never persisted). After the POST resolves, await the navigation the reload
// causes by waiting for the modal to disappear (the reload replaces the
// document), then for the SPA to finish booting.
async function savePrefsAndReload(page: Page): Promise<void> {
  const postDone = page.waitForResponse(
    r => r.url().includes('/xhr/prefs') && r.request().method() === 'POST' && r.ok(),
  );
  await page.locator('#pref_save_btn').click();
  await postDone;
  // The reload (window.location.reload() in prefs.js .then()) destroys the
  // modal; wait for it to leave the DOM, then for the SPA to boot fresh.
  await expect(page.locator('#pref_modal')).toHaveCount(0);
  await waitForViewReady(page);
}

test.describe('Preferences: Language row', () => {

  test('selecting a language and saving reloads and persists', async ({ page }) => {
    await clearUserPrefs(USER1.login);
    await logIn(page, USER1);
    await openPrefs(page);

    // Switch the Materialize select to German and save.
    await selectPrefLang(page, 'de');
    await savePrefsAndReload(page);

    // Reload lands us back in the SPA (booted) in German.
    expect(await prefLanguage(USER1.login)).toBe('de');
  });

  test('picking the deployment-default language (en) pins it', async ({ page, context }) => {
    // There is no "Default" entry: a NULL pref shows the default language
    // (en) applied. Explicitly picking en pins it (non-NULL) and sets the cookie.
    await seedUserPref(USER1.login, 'de');
    await logIn(page, USER1);
    await openPrefs(page);

    await selectPrefLang(page, 'en');
    await savePrefsAndReload(page);

    expect(await prefLanguage(USER1.login)).toBe('en');
    const cookies = await context.cookies();
    expect(cookies.find(c => c.name === 'warp_lang')?.value).toBe('en');
  });

  test('saving with no language change does not pin NULL', async ({ page }) => {
    // NULL pref: a normal prefs save (toggle a feature) must keep language NULL.
    await clearUserPrefs(USER1.login);
    await logIn(page, USER1);
    await openPrefs(page);

    const lever = page.locator('label:has(#pref_zone_show_seat_names) .lever');
    await lever.scrollIntoViewIfNeeded();
    await lever.click();
    await page.locator('#pref_save_btn').click();

    await expect(page.locator('.toast', { hasText: 'Preferences saved' })).toBeVisible();
    // Language stays NULL (Default), not pinned to the deployment default.
    expect(await prefLanguage(USER1.login)).toBeNull();
  });
});

// ─── Precedence / shared device ───────────────────────────────────────────

test.describe('language precedence', () => {

  test('user pref beats a stale cookie; bootstrap resets the cookie', async ({ page, context }) => {
    await seedUserPref(USER1.login, 'de');
    // A stale cookie from another user on the shared device. Seed it on the
    // app's real origin (random-port 127.0.0.1): a bare 'http://localhost'
    // cookie is never sent to the app and would linger in the jar, so
    // context.cookies() would return it and mask the cookie bootstrap actually
    // sets (same trap plan-management.spec.ts documents for warp_theme).
    await context.addCookies([{ name: 'warp_lang', value: 'en', url: getRuntimeInfo().baseURL }]);

    await logIn(page, USER1);
    await expectLoggedIn(page);

    // The SPA renders in the user's pref (de), not the stale cookie (en).
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    // Bootstrap has reset the cookie to the pref.
    const cookies = await context.cookies();
    expect(cookies.find(c => c.name === 'warp_lang')?.value).toBe('de');
  });

  test('no cookie and NULL pref render the deployment default', async ({ page, context }) => {
    await clearUserPrefs(USER1.login);
    await context.clearCookies();
    await logIn(page, USER1);
    await expectLoggedIn(page);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  });
});