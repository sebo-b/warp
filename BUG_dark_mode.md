# BUG: dark-mode plan-view filter test fails

**Test:** `e2e/tests/admin/plan-management.spec.ts`
&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;`plan management >> plan view applies dark filter to map image in dark mode`
**Location:** `e2e/tests/admin/plan-management.spec.ts:235`
**Status:** confirmed — **this is a Playwright test-harness bug, NOT an app bug.**
The application delivers the dark filter correctly; the test's theme cookie
never reaches the inline `<head>` theme script. Surfaced when re-running the
e2e suite on `feature/per-plan-timezone` (coincidental — see Diagnosis).

## Reproduction

```sh
cd e2e && npm test -- --grep "plan view applies dark filter to map image in dark mode"
```

## Symptom

```
Error: expect(received).toContain(expected) // indexOf
Expected substring: "invert"
Received string:    ""
```

The test reads `#planmap .OMBackground`'s `style.filter` and expects it to
contain `invert(...)`. It got the empty string — i.e. `applyPlanMapFilter()`
computed `isDark === false` and set `om.setFilter(null)`.

The page itself renders fine (`.OMBackground` exists, nav is present); only the
filter is empty, meaning `<html theme="…">` was **not** `dark` at the time
`applyPlanMapFilter()` ran.

## Diagnosis — this is a Playwright test-harness bug, not an app bug

The per-plan-TZ branch (`feature/per-plan-timezone`) touches nothing on the
theme / dark-filter path. `git diff main..HEAD` shows zero changes to:

- `warp/templates/base.html` — the inline `<head>` pre-paint theme script that
  reads the `warp_theme` cookie and stamps `<html theme="dark|light">`.
- `js/views/plan.js` — `applyPlanMapFilter()` + its `MutationObserver`
  (`applyPlanMapFilter` reads `documentElement.getAttribute('theme') === 'dark'`
  and only adds `invert(...)` etc. when dark).
- `js/base/base.js` — `initThemeToggle()` / `warpThemeApply` delegation.
- `js/base/style.css` — the `:root[theme="dark"]` rules.
- The `setThemeCookie` test helper (`e2e/tests/admin/plan-management.spec.ts`).

The only plan-view change the TZ branch made is `view.plan()` selecting an extra
column on the *same* row (`Plan.dark_filter, Plan.timezone` — both already
selected separately before; now one select) and `plan.html` exposing one extra
global (`warpGlobals.planTimezone`). Neither can clear the filter.

## Cause (confirmed)

A cookie / theme-resolution race in the test harness, not application code.
Verified against the live container (port 37333):

1. `setThemeCookie(page, 'dark')` runs **before** `page.goto('/plan/1')`. At
   that point `page.URL()` is `''`, so the helper defaults the cookie domain to
   `'localhost'`:

   ```js
   async function setThemeCookie(page, theme) {
     const url = page.URL();
     const domain = url ? new URL(url).hostname : 'localhost';
     await context.addCookies([{ name:'warp_theme', value:theme, domain, path:'/', ... }]);
   }
   ```
2. The e2e container serves on a **random port** (auto-detected by
   `global-setup.ts`, e.g. `127.0.0.1:34127`). Playwright's `baseURL` fixture
   resolves to that random host. A cookie scoped to domain `localhost` is **not
   guaranteed to be sent** to `127.0.0.1:<port>` (cookie domain must match the
   request host; `localhost` ≠ `127.0.0.1` for cookie purposes).
3. With no `warp_theme` cookie received, the inline `<head>` script defaults to
   `'auto'`, which resolves via `prefers-color-scheme`. Playwright's default
   Chromium emulation reports `prefers-color-scheme: light` → `theme="light"` →
   `isDark === false` → empty filter.

The other admin-plan-management tests that don't depend on the theme cookie
pass, consistent with a theme-cookie-only failure.

## Verification (done, against the live container on port 37333)

1. DB: `plan 1 dark_filter = {"id":"smart", "invert":100, ...}` — populated, correct.
2. Authenticated `GET /plan/1` with `warp_theme=dark` returns HTTP 200 and the
   rendered page contains `window.warpGlobals.darkFilter = {..."invert":100...}`.
   So the server delivers correct filter data; the filter is applied by pure
   client JS (`plan.js applyPlanMapFilter`) reading `<html theme="dark">`.
3. The inline `<head>` theme script (`base.html`) reads `document.cookie` for
   `warp_theme` and resolves `auto` via `prefers-color-scheme`. Playwright's
   default Chromium reports `prefers-color-scheme: light`, so with **no cookie
   received** → `theme="light"` → `isDark===false` → `om.setFilter(null)` →
   empty `style.filter`. Exactly the observed `Received string: ""`.
4. Cookie-domain mismatch is the mechanism: `global-setup.ts:97` sets the
   Playwright `baseURL = http://127.0.0.1:<port>` (random port, host=`127.0.0.1`).
   `setThemeCookie` runs before `page.goto`, when `page.URL()` is empty, so it
   defaults the cookie `domain` to `'localhost'`. Browsers do not send a
   `domain=localhost` cookie to a request whose host is `127.0.0.1` — different
   host — so the inline script sees no cookie.

The app requires no change.

## Suggested fix

Make `setThemeCookie` set a host-only cookie bound to the actual request host
instead of defaulting to `'localhost'`. Using `url:` (not `domain:`)
creates a host-only cookie that Playwright reliably sends regardless of the
random port's hostname:

```js
// in e2e/tests/admin/plan-management.spec.ts
async function setThemeCookie(page, theme) {
  const baseURL = page.context().request).options.baseURL
    || page.context()._options.baseURL
    || 'http://127.0.0.1';
  await page.context().addCookies([
    { name:'warp_theme', value:theme, url: baseURL, path:'/',
      httpOnly:false, secure:false, sameSite:'Lax' },
  ]);
}
```

Alternatively, emulate dark system theme in the project config
(`use: { colorScheme: 'dark' }` in `playwright.config.ts`) — but that would
entangle unrelated tests, so prefer the cookie fix.

## Confirmation step before applying the fix

1. On the current branch, after the cookie fix, the test should pass; OR
2. On `main`, run the same test — it should fail identically (proving the bug
   predates the per-plan-TZ branch). The fix is test-only, no app change.

## Code paths (for reference when debugging)

- Inline theme script: `warp/templates/base.html:8-39` (`warpThemeApply`,
  reads cookie, resolves auto, stamps `theme` attr).
- Filter application: `js/views/plan.js:983-1015`
  (`applyPlanMapFilter()` → `om.setFilter(...)`, and the `MutationObserver`
  on `documentElement` attributes that re-applies on theme changes).
- Theme toggle (logged-in): `js/base/base.js:955-977` (`initThemeToggle`).
- Test helper: `earp/tests/admin/plan-management.spec.ts` `setThemeCookie`.
