# Code Review — SPA Refactor (`spa-refactor`)

**Scope:** `git diff main...HEAD` — 13 commits, ~4,400 insertions / ~3,700 deletions.
Implementation of `PLAN_SPA_REFACTOR.md` (Flask + Jinja multi-page app → single-page
application: hand-rolled History-API router, `/xhr/*` JSON endpoints, per-view webpack
chunks, shared widget layer).

**Reviewer:** automated multi-angle review (8 finder angles: line-by-line, removed-behavior,
cross-file tracing, reuse, simplification, efficiency, altitude, conventions), each candidate
verified against the source.

---

## Overall assessment

This is a **well-executed refactor with a genuinely clean target architecture**. The router
lifecycle contract, the verbatim server-side migration of the timezone/calendar date math into
`/xhr/plan/getContext`, the `401 SESSION_EXPIRED` JSON contract for XHRs, the `spaURLs()`
single-definition URL table, and the honest e2e adaptations are all the right shape. Unmount
discipline across the nine views is consistent (`table.destroy()` everywhere, listeners on
`ctx.signal`, panzoom/noUiSlider/observers torn down). The diff even quietly fixes a real
pre-existing bug (`modal.js` was calling `closeHook` instead of `cancelHook`).

**However, it is not finished by its own book.** Two categories hold it back:

1. **Correctness holes in the router's error/cancellation paths and in two edit dialogs** —
   several are silent (a lost save, a stale-data poisoning, a blank-screen boot failure) and
   would not be caught by the current green e2e suite.
2. **Single-point-of-truth violations the PR introduces while claiming to eliminate them** —
   a URL table that is bypassed in both directions, duplicated route lists, a copy-pasted
   ~85-line picker, three confirm dialogs that skip the shared helper, and backend sentinels
   re-hardcoded in JS.

Recommend addressing all High findings before merge; the mount-prefix / URL-table item (#11)
in particular undercuts a stated design goal and touches security-adjacent code.

---

## High severity — correctness

### 1. Failed view-chunk import leaves a permanently blank page
`js/app/router.js:72` — `await match.route.load()` sits **outside** the inner `try/catch`
that maps `mount()` rejections to error views. A rejected dynamic `import()` (redeploy replaces
content-hashed chunks while a session is open, or transient network failure) throws after
`root.replaceChildren()` has already cleared the view; the `finally` block still stamps
`data-view-ready` and dispatches `warp:view-ready`. Result: blank `#view-root`, unhandled
promise rejection, no "server down" retry view — even though `renderErrorView(kind='network')`
was built for exactly this. The same missing catch swallows a `URIError` from
`decodeURIComponent` on a malformed `%`-encoded path.
**Fix:** wrap the load + mount in one catch that routes to the network/server error view.

### 2. Table XHRs bypass the 401 session-expiry redirect
`js/lib/tablePage.js:27` — the shared table layer uses Tabulator's built-in ajax
(`ajaxConfig`/`ajaxContentType`) instead of routing through `Utils.xhr`. Table
load/pagination/sort/filter are the most common requests in the app, and they never reach
`Utils._maybeRedirectOnSessionExpired` or the network-down detection built in this same PR.
When a session expires on any table view (users/groups/zones/plans/bookings/assigns), the next
request gets `auth.py`'s 401 JSON, Tabulator fires `dataLoadError`, the `.warp-loading` class
clears, and **nothing else happens** — a silently dead table instead of the debounced login
redirect.
**Fix (deep):** an `ajaxRequestFunc` in `tablePage.js` that delegates to `Utils.xhr`,
unifying 401 handling, network errors, and the spinner counter for free.

### 3. Second edit within one mount silently discards the save
`js/views/plans.js:185` and `js/views/zones.js:440-441` — `saveBtn`/`deleteBtn` click
listeners are added on **every** `showEditDialog()` call but scoped to `ctx.signal` (unmount),
not to dialog close. Open the edit dialog for row A, close it, open it for row B, click Save:
the stale handler from A runs first, calls the shared `editModal.close()`, which synchronously
fires B's `onCloseStart` while B's `resolved` is still `false` → `reject()`. B's own handler's
`resolve()` is then a no-op on the settled promise, and `addEditClicked`'s `.catch(()=>{})`
swallows it. **The modal closes looking successful but no POST is sent — the edit is lost.**
The Delete path also stacks N `confirmDelete` calls (duplicated Yes/No rows). Note `users.js`
and `groups.js` are *not* affected — they guard listener wiring with a once-per-mount check;
`plans.js`/`zones.js` wire inside the per-open promise.
**Fix:** wire the Save/Delete listeners once per mount (as users/groups do), or add them with
a per-open `AbortController` released on close.

### 4. Superseded mount leaks resources and corrupts singletons
`js/app/router.js:105` — when a transition is superseded while its `view.mount()` is still
in flight, the freshly returned `unmount` is discarded by the `seq !== transitionSeq` check
before being assigned to `currentUnmount`, and never invoked. With a slow `getContext`,
navigating plan A → plan B → plan C can run B's mount body against C's already-injected markup
(initializing C's noUiSlider, calling `PlanUserData.init()`/`initBookAs()` with B's pid), then
drop B's unmount. B's OfficeMap window/document listeners and theme `MutationObserver` leak
permanently, `PlanUserData`/`BookAs` are left initialized, and C's own mount then throws
("UserData already initialized" / "BookAs can be initialized only once") → router renders
"Page not found" instead of plan C.
**Fix:** in the superseded branch, invoke the just-returned `unmount` before returning; root
cause is shared with #5 (no XHR cancellation).

### 5. Stale-response race poisons plan user data on fast plan→plan switch
`js/views/modules/planuserdata.js:118` — `PlanUserData.init()` is a fire-and-forget XHR with
no `AbortSignal` and no staleness guard. `Utils.xhr` accepts no signal, so `ctx.signal` never
cancels anything. Navigate plan A → plan B before A's `getUsers` lands: `unmount(A)` resets the
singleton, `mount(B)` fires a second XHR, A's response arrives first and installs plan A's user
list (Book-as autocomplete on plan B now offers plan A's users), and B's own response hits the
setter guard and throws "already initialized" as an unhandled rejection — so B's correct list
never loads.
**Fix:** thread `ctx.signal` into `Utils.xhr` and drop stale responses (or check a
mount-generation token in the `.then`).

### 6. Boot-time XHR failure blanks the app; nav/modal caches never refresh
`js/app/bootstrap.js` and `js/app/main.js:35`:
- **Boot failure → dead app.** `boot()` does `await Promise.all([loadI18n(), bootstrap.get()])`
  with no error handling, and `bootstrap.js` uses **raw `fetch`** (not `Utils.xhr`). A transient
  500 / DB hiccup on `/xhr/bootstrap` or the i18n JSON at page load rejects `boot()` unhandled:
  `router.start()` never runs, `#view-root` stays empty forever, no spinner, no retry, no error
  view. A 401 `SESSION_EXPIRED` at boot throws a generic `Error` and blanks the page instead of
  redirecting to login like `Utils.xhr` would.
- **`refresh()` has zero callers.** `PLAN_SPA_REFACTOR.md §1.2.1` requires plan/zone CRUD to call
  `bootstrap.refresh()` so the nav invalidates; `grep` finds only the definition and a comment.
  An admin who adds/deletes/renames a plan on `/plans` (or a zone on `/zones`) sees a **stale
  top nav, stale `#mobile-nav`, stale prefs "Default plan" select and calendar "Zones to monitor"
  select** for the rest of the session; a deleted plan leaves a dead nav link that lands on the
  error view; `index.js`'s default-plan redirect can target a deleted plan.
- **Duplicated cache.** `bootstrap.js` hand-rolls a promise cache that duplicates
  `js/lib/lazyCache.js` (added in the same PR), and `refresh()` only nulls `data`, so if a
  `get()` is in flight it returns the stale in-flight promise.
**Fix:** wrap `boot()` in try/catch → error view with retry; build `bootstrap` on `lazyCache` +
`Utils.xhr`; call `bootstrap.refresh()` + `nav.render()` from plan/zone CRUD success; delete the
unused `current()` export.

### 7. Stored XSS via group name rendered with `innerHTML`
`js/views/groupAssign.js:72` — `addToGroupModalHeader.innerHTML = TR("Add to group %{group}",
{group: groupName})`. Polyglot's `TR()` does **not** HTML-escape interpolations, and `groupName`
comes straight from `/xhr/groups/info`. A group whose stored name contains markup
(e.g. `<img src=x onerror=…>`) executes in any admin's session when they open
`/groups/assign/<group>` and click "add to group". This is a **regression**: the deleted
server-rendered `group_assign.html` was Jinja-autoescaped. Its sibling `zoneAssign.js:106`
already does the safe thing (`textContent`) for the identical pattern.
**Fix:** use `textContent`, matching `zoneAssign.js`.

---

## Medium severity — correctness

### 8. Preferences dropdowns duplicate on load/save/open
`js/app/modals/prefs.js:54,91,99` — `M.FormSelect.init` is called repeatedly on the same
`<select>`s (boot init, then `applyPrefsToUI()` on every prefs load **and** every Save, plus
`onOpenStart`) **without destroying the previous instance**. `js/lib/formSelect.js` exists
precisely to destroy-then-init ("Idempotent: safe to call on an already-initialized `<select>`"),
but `prefs.js` bypasses it and calls the raw API, so each re-init wraps the select in another
`.select-wrapper` — stacked/duplicated "Default plan" / "Default day" dropdown triggers after
opening the modal or saving.
**Fix:** route all four sites through `initFormSelect()`.

### 9. Rapid navigation can double-invoke the previous unmount
`js/app/router.js:57` — `currentUnmount` is cleared only *after* it is awaited, so two rapid
navigations can both observe it non-null and both `await` the same function. A view's `unmount`
runs twice (double `table.destroy()` / `om.destroy()` / `BookAs.reset()`); the second throw is
swallowed by the surrounding catch, so any teardown *after* the throwing line is silently
skipped (observers/sliders leak across the navigation).
**Fix:** null `currentUnmount` before awaiting it.

### 10. Unsanitized `return=` in assign back-links (pre-existing, unfixed)
`js/views/zoneAssign.js:28`, `js/views/groupAssign.js:28` — `ctx.query.return` is written
verbatim into the back-link `href` via `setAttribute`. A crafted
`?return=javascript:alert(document.cookie)` executes on click (the router's click interception
passes it through on origin/route mismatch), and `?return=https://evil.example` is a silent
open redirect. **This sink is pre-existing on `main`** (`request.args.get('return')` was rendered
into `href` there too, and Jinja autoescaping does not neutralize the `javascript:` scheme), so
it is not a regression — but these files were rewritten wholesale and the refactor is the moment
to fix it. `planModify.js` is safe because it uses `ctx.navigate()`, which routes through
`new URL` + `matchRoute` and lands on the error view for a non-route value.
**Fix:** validate `return` is a same-origin, route-matching path before assigning it.

---

## Single-point-of-truth / architecture

### 11. URL table bypassed in both directions; no mount-prefix support
Strong consensus across four angles. `spaURLs()` (`warp/view.py`) documents itself as the
prefix-aware "single-definition union" of the old per-page URL tables — yet:
- `js/app/nav.js:21` hardcodes `/bookings` and `/plan/'+id`; `groupAssign.js:27` /
  `zoneAssign.js:27` / `planModify.js:20` hardcode `/groups` / `/zones` / `/plans` `?return=`
  fallbacks; `index.js` builds `/plan/'+id` by string concat.
- The `spaURLs()` entries meant for exactly these (`groups`, `zones`, `plans`, `bookings`,
  `bookingsReportPage`) and the `hasLogout` / `hasChangePassword` warpGlobals injections have
  **zero JS readers** — computed and shipped on every shell render for nothing.
- `js/app/routes.js` matches raw `location.pathname` with no base-path stripping.

Under a `SCRIPT_NAME` / reverse-proxy mount (e.g. `/warp`), `location.pathname` is
`/warp/users`, which matches no pattern → **every route, including `/`, renders the client
"Page not found" view**, and the hardcoded nav links escape the prefix. The prefix story the
plan sells is only true for XHR URLs today.
**Fix:** consume the `spaURLs()` entries in nav/return-links, derive a router base path from
`URLs`, and delete the now-truly-dead entries — or, if prefix support is deferred, delete the
entries and say so. Keeping both forms is the worst of both.

### 12. Seven duplicated admin route stubs + route list maintained twice
`warp/view.py:149-197` — `users`/`groups`/`zones`/`plans`/`groupAssign`/`zoneAssign`/`planModify`
each repeat a byte-identical `if not flask.g.isAdmin: flask.abort(403); return
flask.render_template('spa.html')`. The SPA route list is also hand-synced between `view.py` and
`js/app/routes.js` with no shared source: a client route without the server twin 404s on
deep-link/refresh; a server route without the client twin renders the SPA "not found" on a URL
the server serves. The client router has **no admin guard concept** at all, so back/forward into
an admin route after mid-session demotion mounts the view and fails opaquely via #2.
**Fix:** a `(rule, endpoint, admin)` table looped through `bp.add_url_rule` (Flask allows one
function under many endpoints, so `url_for` keeps working) — ~80 lines → ~15, one list to mirror.

### 13. ~85-line user-picker clone between the two assign views
`js/views/zoneAssign.js:98` is a near-verbatim clone of `js/views/groupAssign.js:72-155` — both
new in this PR. `showModal`/`initModal` lazy-init, `usersList` POST, `warpDialog` wrap, the mini
`createTable` config, `makeUserStr`/`makeUserStrRev` autocomplete roundtrip, and identical
`M.Autocomplete.init` options are duplicated line-for-line and have **already drifted** (header
set inside vs. outside `initModal`; group version uses `innerHTML` per #7, zone uses
`textContent`). Extract a shared `js/views/modules/userPicker.js`.

### 14. Three confirmations bypass the shared `confirmDelete`
`js/views/bookings.js:196`, `js/views/planModify.js:368` and `:587` re-implement the
`buttons` + `onButtonHook` WarpModal boilerplate that `lib/confirmDelete.js` was created (in this
PR) to own — the last inventing a third idiom with boolean button ids (`id: true/false`). None
get `confirmDelete`'s `onCancelHook` Esc/outside-click handling, so dismiss semantics now differ
across three in-repo idioms. (`confirmDelete`'s own header comment is stale — it says an
unhandled dismiss "never resolves" while the code resolves `false`.)

### 15. Backend sentinels re-hardcoded in JS
Violates the project rule (`no-duplicated-frontend-constants`) that shared backend↔JS constants
flow through `window.warpGlobals`, defined once in the backend — a channel this same PR
establishes correctly for `ungroupedFilterKey` / `maxReportRows`:
- `js/views/users.js:34` (and `groups.js`): `account_type >= 100` duplicates
  `ACCOUNT_TYPE_GROUP = 100` (`warp/db.py`).
- `js/views/zoneAssign.js:30-36`: zone roles `10/20/30` duplicate `ZONE_ROLE_*`.
- `js/views/zones.js:22-28`: zone-type labels duplicate `ZONE_TYPE_*`.
- `js/app/modals/changePassword.js:17`: `minPasswordLength || 6` fallback duplicates
  `MIN_PASSWORD_LENGTH = 6` (`warp/config.py`) — lower confidence (warpGlobals is the primary
  source; `6` is only a fallback).
Carried over from pre-refactor code, but these files were rewritten wholesale — the refactor was
the moment to route them through `warpGlobals`. Renumbering a role in `db.py` silently breaks the
filters/editors client-side.

---

## Testing / process

### 16. No e2e coverage of the client error view
`PLAN_SPA_REFACTOR.md §5` says deep-link 403/404 assertions "now assert the client `#view-error`
view", but **no test or helper references `#view-error` or `data-view="error"`** — the adapted
specs (`access.spec.ts`, `zone-permissions.spec.ts`, `zones.spec.ts`, `groups.spec.ts`) assert
only the raw XHR status. If `router.js`'s mount-error mapping regresses (a 403 gets swallowed and
the plan view half-mounts with undefined context, or the error view stops rendering), the suite
stays green while an unauthorized deep-link sees a broken page instead of the denial view. Add at
least one spec asserting `body[data-view="error"]` on a forbidden deep link.

---

## Minor / cleanup

- **Dropdown init race papered over in e2e.** Shell `.dropdown-trigger`s paint immediately but
  are wired only after `boot()` awaits two fetches (`main.js:35`); `e2e/helpers/settings.ts` and
  `expectLoggedIn` wait around it rather than fixing it. Delegate `.dropdown-trigger` the way
  `triggers.js` already does for `.modal-trigger`/`.sidenav`, or move the DOM-only inits ahead of
  the network awaits.
- **`js/views/index.js:20`** — the `matchRoute('/plan/'+id)` guard is dead WP7 scaffolding
  (always true since `/plan/:pid` shipped); its `matchRoute` import exists only to feed it. The
  plan's promised "guard against loops when plan inaccessible" is not actually implemented
  anywhere.
- **Serialization waterfalls.** `plan.js` mount serializes `getContext` → `getSeats` → `getUsers`
  though the latter two depend only on `pid`; `boot()` serializes the first chunk import behind
  i18n+bootstrap; `zoneAssign`/`groupAssign`/bookings-report await a tiny name/context lookup
  before building the table. Fire the independent requests concurrently.
- **Stale comments referencing deleted files** — `js/base/style.css:730` and `groupChips.js:30`
  cite `base.js`; `view.py:15` cites `plan.html:172` / `base_logged.html:106`; `xhr/groups.py`
  and `xhr/zones.py` cite the deleted `group_assign.html` / `zone_assign.html`.
- **`js/views/zones.js:256`** hardcodes the 300 ms dialog close-animation in a `setTimeout`
  instead of `warpDialog`'s `onCloseEnd` hook — races `router.js`'s `replaceChildren` if the view
  unmounts within the window.
- **`js/lib/formDialog.js`** was honestly descoped to two error-row helpers (documented in-file),
  but the plan doc still advertises the full form-dialog wrapper — update the plan or note it.

---

## What checked out clean (verified, not flagged)

- All 41 `warpGlobals.URLs.*` keys read in JS exist in `spaURLs()`; the five `/xhr/*` JSON shapes
  match their consumers field-for-field; per-plan `warpGlobals` keys are seeded by `plan.js` mount
  before `seat.js`/`calendarGrid.js` read them.
- `getContext` moved the calendar/timezone date math **verbatim** server-side (no TZ logic leaked
  to JS); `default_plan` is int-coerced so `index.js`'s strict `===` accessibility check is sound.
- Admin 403s are retained on every admin page route and on `/bookings/report`; the report XHR has
  its own admin guard; `/plan/image` access check is untouched; group/zone info lookups are
  admin-guarded with correct 404s.
- The `401`-for-`/xhr` change lives in the right layer (`auth.py` session middleware, path-based,
  no new route); the endpoints-coverage spec gained all five new entries.
- Every view returns an `unmount` that destroys its Tabulator(s); panzoom/noUiSlider/observers are
  cleaned up in `plan.js`/`planModify.js`; the spinner `acquire`/`release` counter stays balanced
  per transition including the nested index→plan redirect.
- Nav plan names are HTML-escaped (`nav.js`); the `modal.js` `closeHook`→`cancelHook` fix is a
  real bug fix; templates share `public_nav.html` rather than duplicating chrome.

---

## Summary

| # | Severity | Area | File |
|---|----------|------|------|
| 1 | High | Blank page on chunk-load failure | `js/app/router.js:72` |
| 2 | High | Table XHRs skip 401 redirect | `js/lib/tablePage.js:27` |
| 3 | High | Second edit silently loses save | `js/views/plans.js:185`, `zones.js:440` |
| 4 | High | Superseded mount leaks + corrupts singletons | `js/app/router.js:105` |
| 5 | High | Stale-response race on plan switch | `js/views/modules/planuserdata.js:118` |
| 6 | High | Boot failure blanks app; `refresh()` never called | `js/app/bootstrap.js`, `main.js:35` |
| 7 | High | Stored XSS via group name `innerHTML` | `js/views/groupAssign.js:72` |
| 8 | Medium | Prefs dropdowns duplicate | `js/app/modals/prefs.js:54` |
| 9 | Medium | Double-invoke of previous unmount | `js/app/router.js:57` |
| 10 | Medium | Unsanitized `return=` sink (pre-existing) | `js/views/zoneAssign.js:28`, `groupAssign.js:28` |
| 11 | Arch | URL table bypassed; no mount-prefix support | `js/app/nav.js`, `routes.js`, `view.py` |
| 12 | Arch | 7 duplicated admin stubs; route list ×2 | `warp/view.py:149` |
| 13 | Arch | ~85-line picker clone | `js/views/zoneAssign.js:98` |
| 14 | Arch | 3 confirmations bypass `confirmDelete` | `bookings.js:196`, `planModify.js:368,587` |
| 15 | Arch | Backend sentinels hardcoded in JS | `users.js:34`, `zoneAssign.js:30`, `zones.js:22` |
| 16 | Test | No e2e coverage of `#view-error` | `e2e/tests/booking/access.spec.ts` |
