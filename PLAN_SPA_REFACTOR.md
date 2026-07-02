# WARP SPA Refactor — Implementation Plan

## Context

WARP is a Flask + Jinja multi-page app: 12 server-rendered pages, each loading its own webpack bundle via generated `templates/headers/*.html` partials. Every navigation is a full page load; each view JS file re-implements the same patterns (9 near-identical Tabulator setups, 8 modal-form flows, 6 delete confirmations, 15+ formatters). The goal is a single-page application with a clean architecture: one shell, client-side routing, a shared widget layer that eliminates the copy-paste, e2e kept green, the existing global spinner reused for route transitions.

**Decisions made with the user:**
- No frontend framework. **Hand-rolled History-API router** (~120 lines) — evaluated against Navigo 8 and Universal Router; both only solve the trivial part (matching 10 routes) while the real work (history wiring, link interception, view lifecycle) is hand-written either way. Zero new dependencies.
- History API routing — all existing URLs (`/bookings`, `/plan/<pid>`, `/users`, `?return=` query convention, …) keep working, including deep links and refresh.
- Login/logout/SSO, `/change_password` redirect flows, and iCal action pages stay server-rendered outside the SPA.
- Big-bang refactor on a branch; merge when the full e2e suite is green.

**Hard constraints discovered in exploration:**
- E2E (39 Playwright specs) relies on: real URL navigation (`page.goto`), `#mobile-nav` attached after login (`helpers/auth.ts:19`), modal IDs (`#action_modal`, `#edit_modal`, …), Tabulator CSS selectors, URL assertions (`toHaveURL(/\/plans$/)`), 72 uses of `waitForLoadState('networkidle')`. `endpoints-coverage.spec.ts` introspects `/debug/endpoints` and requires every Flask rule to be listed.
- `calendarGrid` / `defaultSelectedDates` / `today` / `planTimezone` are computed server-side in `warp/view.py` (`utils.getCalendarGrid`) for timezone correctness — must stay server-computed, moved behind an XHR endpoint.
- Project rule (memory): shared backend↔JS constants flow through `window.warpGlobals`, defined once — never duplicated in JS.
- Spinner already exists: `#spinner` in `base_logged.html` + ref-counter in `js/views/modules/utils.js` (`Utils.xhr`). Keep the mechanism, extend to route transitions.

---

## 1. Backend changes

### 1.1 SPA shell + view.py rewrite
- **New `warp/templates/spa.html`** (extends `base.html`; `base_logged.html` folds into it and is deleted):
  - `{% include 'headers/app.html' %}` (single webpack-generated header).
  - Inline `window.warpGlobals`: `URLs` (see 1.3), `login`, `userName`, `isAdmin`, `minPasswordLength`, `hasChangePassword`, `hasLogout`, `i18nUrl`, `ungroupedFilterKey`, `maxReportRows`, `daysInAdvance`, `bookOpen`/`bookClose` (today `data-min/max` attrs in `base_logged.html:106`, `plan.html:172`).
  - Static markup with **unchanged IDs** (e2e DOM contract): `#spinner`; nav skeleton with Jinja-rendered static right side (`{% if g.isAdmin %}` for `#admin_menu_dropdown`, theme toggle include, `#user_menu_dropdown`); `#mobile-nav` sidenav with static items Jinja-rendered and an empty region for dynamic plan links; the three shared dialogs `#pref_modal`, `#calendar_modal`, `#change_password_modal` copied from `base_logged.html:77-256` minus the two Jinja `<option>` loops (populated client-side from bootstrap on open); `<div id="view-root">` router mount point.
- **`warp/view.py`:**
  - Delete `headerDataInit` context processor (lines 11–68) — logic moves to `/xhr/bootstrap`.
  - Keep **explicit routes** (not a catch-all) so `endpoints-coverage.spec.ts` sees identical rules and unknown paths still 404. Each body becomes `return flask.render_template('spa.html')` keeping only cheap guards: admin `403` checks on admin pages and `/bookings/report`; drop DB lookups/404s on assign/modify routes (client renders a not-found error state from the XHR 404); drop the `/plan/<pid>` access computation (moves to context endpoint); drop the `/` default-plan redirect (client-side now).
  - `/plan/image/<pid>` stays as-is (binary route). `login.html`, `auth_error.html`, `ical_action.html` stay server-rendered.

### 1.2 New XHR endpoints (existing sub-blueprint style in `warp/xhr/`)
1. **`GET /xhr/bootstrap`** — new `warp/xhr/bootstrap.py`, registered in `warp/xhr/__init__.py`. One call at shell boot: `{plans, zones, defaultPlan, isAdmin, login, name}` — the moved `headerDataInit` queries + `get_user_prefs(login).get('default_plan')`. Client keeps a `refresh()` so plan/zone CRUD invalidates the nav.
2. **`GET /xhr/plan/getContext/<int:pid>`** — in `warp/xhr/plan.py`. Everything `view.plan` computes today (`view.py:109-190`): `{calendarGrid, defaultSelectedDates, today, planTimezone, planPreviewPrefs, darkFilter, isZoneAdmin, isZoneViewer}`. Same access checks → `403` JSON. Move the date code verbatim — no date math migrates to JS. `planModify` also calls it (for `darkFilter`).
3. **`GET /xhr/groups/info/<login>`** — `{login, name}`, 404 if not a group (replaces `view.py:245-249`).
4. **`GET /xhr/zones/info/<int:zid>`** — `{id, name}`, 404 if missing (replaces `view.py:263-265`).
5. **`GET /xhr/bookings/context`** — `{today}` in UTC, fetched on report-mount so the 2-week default filter window stays backend-computed and fresh (a long-lived SPA crosses midnight; can't be shell-injected).

### 1.3 URL table: shell-injected via `spaURLs()`
New function in `warp/view.py` building the full `warpGlobals.URLs` dict with `url_for` — union of the per-page URL tables currently in the 10 templates, keeping the `__LOGIN__`/`__ZID__`/`__PID__` placeholder convention, plus `login` (for 401 redirect), `changePassword` (conditional), `planImage`, and `distBase: url_for('static', filename='dist/')` (runtime webpack publicPath). Rendered once in `spa.html` via `| tojson`. Rationale: `url_for` is mount-prefix/proxy-aware; a hardcoded JS route table would break prefixed deployments and violate the single-definition rule.

### 1.4 Expired-session 401 for `/xhr/*`
In `warp/auth.py` `session()` (lines 187-222): where it currently `flask.redirect(...)`, if `flask.request.path.startswith('/xhr')` return `jsonify({"code": "SESSION_EXPIRED"}), 401` instead. Client: `Utils.xhr` on 401 → `window.location.assign(warpGlobals.URLs.login)` (full page load; login is server-rendered). Debounce so parallel 401s trigger one redirect. No new route ⇒ no endpoints-coverage change for this.

---

## 2. Frontend architecture

### 2.1 Module tree (new layout under `js/`)
```
js/app/
  main.js        entry: boot sequence (2.4)
  router.js      hand-rolled History-API router + transition lifecycle
  routes.js      registry: pattern → { name, load: () => import(/* webpackChunkName */ ...) }
  bootstrap.js   fetch/cache/refresh /xhr/bootstrap
  i18n.js        async i18n (from base.js:234-276; fetch() instead of sync XHR)
  nav.js         builds plan links in nav + #mobile-nav from bootstrap; sets .active per route
  spinner.js     ref-counter extracted from Utils.xhr; acquire()/release(); used by XHR + router
  materialize.js M-compat layer + warpLiftSelect (base.js:13-129, 221-231)
  dialog.js      WarpDialog + window.warpDialog (base.js:130-220, 232)
  theme.js       theme toggle (base.js:962-972)
  triggers.js    delegated .modal-trigger/.sidenav handling (base.js:980-1016)
  modals/prefs.js, modals/calendar.js, modals/changePassword.js   (from base.js:292-929; option lists from bootstrap)
js/lib/
  tablePage.js, formDialog.js, confirmDelete.js, formatters.js, formSelect.js, lazyCache.js
js/views/
  users.js … planModify.js       (converted in place, same filenames)
  html/users.html … index.html   (view markup fragments, webpack asset/source)
  modules/                       (unchanged: seat.js, officeMap.js, calendarGrid.js, …)
```
`js/base/base.js` (1017 lines) is deleted after decomposition; `js/base/style.css` imported by `main.js`.

### 2.2 Router + view lifecycle
Each view default-exports `{ html, async mount(ctx) → unmount }` with `ctx = { root, params, query, navigate, signal }`. Router transition order:
1. `spinner.acquire()`; clear `data-view-ready` from `<body>`.
2. Await previous `unmount()`: destroy Tabulator instances, panzoom, noUiSlider, FormSelect/Autocomplete; all view-scoped listeners registered with `{signal: ctx.signal}` (AbortController) die automatically; `root.replaceChildren()`. View dialogs (`#edit_modal`, `#action_modal`, …) live inside `#view-root` and are recreated per mount — IDs preserved for e2e.
3. Dynamic-import the view chunk, `root.innerHTML = view.html`, `TR.updateDOM(root)`, await `mount(ctx)`.
4. `spinner.release()`; set `document.body.dataset.view = name` + `data-view-ready`; dispatch `warp:view-ready`.
5. On mount error (403/404 from context XHRs): render a standard `#view-error` view — the client-side replacement for server 403/404 on deep links.

Link interception: one delegated `document`-level click listener (same-origin `<a>`, no `target`/`download`/modifier keys, path matches a registered route → `preventDefault` + `navigate()`). `popstate` runs the full transition. Query strings preserved (the `?return=` convention on assign/modify routes keeps existing e2e URL assertions passing; views read `return` from `ctx.query` with fallbacks `/groups`, `/zones`, `/plans`).

View markup migration: each page template's `overlays`/`content` blocks (e.g. `users.html:15-87`, `plan.html:37-202`) move verbatim to `js/views/html/<name>.html` imported via webpack `type: 'asset/source'`. Jinja conditionals become conditional DOM removal in `mount()` from context data; `config` attrs read `warpGlobals`; `icons/*.html` includes are inlined into fragments (theme_toggle stays in shell).

### 2.3 Duplication elimination map
| New module | Replaces | Consumers |
|---|---|---|
| `lib/tablePage.js` | 9 Tabulator setups (`users.js:42`, `groups.js:35`, `zones.js:295`, `plans.js:95`, `bookings.js:324`, `groupAssign.js:69/138`, `zoneAssign.js:94/172`): standard options, langs from i18n, ajax/pagination/sort/filter wiring, auto-destroy registration | 7 table views |
| `lib/formDialog.js` | **Descoped** to the two error-row helpers (`showFieldError`/`clearFieldError`) every `showEditDialog` repeats after a failed save. The wider "open a form dialog and resolve with the user's action" wrapper originally planned here was never adopted — every view kept its own `showEditDialog` with view-specific field wiring — so it was removed rather than left as dead scaffolding. | users, groups, zones, plans |
| `js/views/modules/userPicker.js` | The shared "pick users into a staging table, then POST them" modal skeleton, extracted from the ~85-line clone between `groupAssign.js` / `zoneAssign.js`. Each view supplies its columns, header text, `rowFromLogin`, and `onAdd` payload builder. | groupAssign, zoneAssign |
| `lib/confirmDelete.js` | 6 delete confirmations (`users.js:206-221`, `groups.js:121-145`, `zones.js:426-440`, `plans.js:162-175`, assigns inline); wraps existing `views/modules/modal.js` WarpModal | same |
| `lib/formatters.js` | 15+ icon/userType/zoneRole/chip/timestamp Tabulator formatters | zones, plans, bookings, assigns, users |
| `lib/formSelect.js` | 8+ getInstance/destroy/init sequences | all modal forms + planModify |
| `lib/lazyCache.js` | 4 fetch-once caches (user groups, timezones, zone groups/names) — with `invalidate()` called by CRUD mutations (no page reloads to clear them anymore) | users, plans, zones |

`views/modules/modal.js` and `utils.js` stay; `utils.js` drops the spinner counter (→ `app/spinner.js`) and gains the 401 handler.

### 2.4 Boot sequence (`app/main.js`)
1. Shell parses; inline `warpGlobals` present. First statement: `__webpack_public_path__ = warpGlobals.URLs.distBase`.
2. In parallel: fetch i18n JSON (Polyglot/`TR` behind a promise now) and `/xhr/bootstrap`.
3. Init materialize compat, dialogs, theme, triggers, shared modals; build nav; `TR.updateDOM()`.
4. Start router on `location.pathname + search`. `/` route: if `bootstrap.defaultPlan` ∈ `bootstrap.plans` → `navigate('/plan/'+id, {replace:true})` (mirrors old server redirect; guard against loops when plan inaccessible); else mount trivial index view. `/bookings` and `/bookings/report` map to the same module with mode from the path — distinct routes, full unmount/mount, no table hot-swap.

---

## 3. Webpack (`js/webpack.config.js`)
Collapse the two-config array + dynamic `fillConfig` into one config:
- `entry: { app: './app/main.js', public: './base/public.js' }` — `public.js` is a small new entry for server-rendered pages (`login.html`, `ical_action.html`, `auth_error.html`): just the i18n `.TR` label handling extracted from base.js.
- `HtmlWebpackPlugin` → `headers/app.html` and `headers/public.html` only (keep the existing `templateContent: headTags` mechanism; no manifest needed).
- Per-view chunks via dynamic `import()` in `routes.js`; mini-css-extract loads async-chunk CSS automatically (Tabulator CSS arrives with the first table view).
- Keep `splitChunks {chunks:'all', minChunks:2}`, deterministic moduleIds, `runtimeChunk`.
- Add rule `{ test: /views\/html\/.*\.html$/, type: 'asset/source' }`.
- `output.publicPath: ''`; runtime publicPath from `warpGlobals.URLs.distBase` (mount-prefix-safe).
- `base.html`: replace `{% include 'headers/base.html' %}` with `{% block bundle %}{% endblock %}`; public pages include `headers/public.html`, `spa.html` includes `headers/app.html`.

## 4. Templates
- **Deleted:** `base_logged.html`, `index.html`, `bookings.html`, `users.html`, `groups.html`, `zones.html`, `plans.html`, `group_assign.html`, `zone_assign.html`, `plan.html`, `plan_modify.html`, `headers/*` (except the two generated), `icons/help_icon.html` + `schedule_icon_side.html` (inlined into view fragments).
- **Kept:** `base.html` (modified), `login.html`, `auth_error.html`, `ical_action.html`, new `spa.html`.

## 5. E2E adaptation
- New helper `e2e/helpers/spa.ts`: `waitForViewReady(page, view?)` asserting `body[data-view="…"][data-view-ready]` attached.
- The 72 `waitForLoadState('networkidle')` calls: replace with `waitForViewReady` only where they break (client-side navigations); direct `page.goto()` cases still get a real page load and mostly keep working — sweep in the final phase, don't rewrite wholesale.
- **Untouched:** `helpers/auth.ts` (`#mobile-nav` stays in shell at first paint), modal-ID assertions, Tabulator selectors, `login.spec.ts`/`flash_message`, URL assertions.
- **Honest adaptations:** deep-link 403/404 assertions on `/plan/<pid>` and assign routes now assert the client `#view-error` view; `endpoints-coverage.spec.ts` gains 5 entries (`/xhr/bootstrap`, `/xhr/plan/getContext/<int:pid>`, `/xhr/groups/info/<login>`, `/xhr/zones/info/<int:zid>`, `/xhr/bookings/context`) — each exercised by existing flows.

## 6. Work packages (ordered, single branch; each ends with verification)
1. **Backend foundations** — new XHR endpoints, 401-for-xhr, `spaURLs()`, `spa.html`, `view.py` rewrite. *Verify:* `tests/` pass; curl each new endpoint in the dev container; any deep link serves the shell.
2. **App shell** — webpack single-entry + `public` entry; all `js/app/*` modules with a placeholder view. *Verify:* login → nav from bootstrap, theme toggle, three shared modals work; `login.spec.ts` green.
3. **Shared widget layer** — `js/lib/*`. *Verify:* API reviewed against all 7 consumers before converting views.
4. **Simple CRUD views** — users, groups, zones, plans. *Verify:* `e2e/tests/admin/*` green.
5. **Assign views** — groupAssign, zoneAssign (params + `?return=`; names from info endpoints). *Verify:* assign + zone-admin specs green.
6. **Bookings** — one module, two route modes; `/xhr/bookings/context` on report mount. *Verify:* `bookings-page` specs green.
7. **Plan view** — getContext-driven mount; panzoom/calendarGrid/nouislider lifecycle; refetch context on every mount (stale grid across midnight would regress today's per-load compute). *Verify:* `booking/*` + officemap specs; manual: plan→users→plan twice, heap snapshot for detached nodes; hard-refresh each route.
8. **planModify** — `darkFilter` from getContext; save returns via `navigate(ctx.query.return)`. *Verify:* zone-editor/modify specs green.
9. **Cleanup + full pass** — delete dead templates/`base.js`/old headers, networkidle sweep, error-view test adaptations, endpoints-coverage entries; full Docker e2e suite green; merge.

## 7. Risks
- **calendarGrid timezone correctness** — mitigate by moving `view.py:142-170` verbatim into `getContext`; no date math in JS; refetch per mount.
- **Memory leaks / stale listeners** — all view listeners on `ctx.signal`; Tabulator `destroy()` per unmount; audit `views/modules/*` for module-level state surviving re-mount (e.g. `plan.js` calendar var).
- **Materialize re-init** — instances bound to destroyed DOM throw; per-mount dialog recreation + `lib/formSelect.js`; preserve the Chips auto-scan quirk noted in `users.html:48-53`.
- **Back/forward** — popstate runs the full transition; dialogs close on navigation (WarpDialog dirty-tracking decides prompt vs close).
- **401 mid-flight** — debounce the login redirect across parallel failing XHRs.
- **Deep-link refresh** — every route must boot cold from the shell; hard-refresh check is part of every view phase's verification.

## Verification (end-to-end)
- `cd js && npm run build` (webpack) produces `app` + `public` headers and route chunks.
- Run the app in the e2e Docker container; manually exercise: login → nav → each route → back/forward → hard refresh on `/plan/1` and `/users` → logout → session-expiry 401 path.
- `cd e2e && npx playwright test` (full suite, workers=1) — must be fully green before merge, including `endpoints-coverage.spec.ts` with the 5 new entries.

## 8. Post-review corrections

A multi-angle code review (`CODE_REVIEW.md`) found issues after the initial
implementation; all were addressed on this branch. Summary of what changed vs
the plan above, so the plan reflects what actually shipped:

- **Router error/cancellation paths** (`js/app/router.js`): failed view-chunk
  `import()` now routes to the "server down" retry view (was a blank page); a
  malformed `%`-encoded path no longer crashes the transition; a transition
  superseded while `mount()` is in flight now runs the just-returned `unmount`
  (was leaked, corrupting `PlanUserData`/`BookAs` singletons); the previous
  unmount handle is nulled before it is awaited so two rapid navigations can't
  double-invoke it.
- **Table XHRs** (`js/lib/tablePage.js`) now go through a `Utils.xhr`-backed
  `ajaxRequestFunc`, so table load/pagination/sort/filter share the 401
  session-expiry redirect, network-down handling, and ref-counted spinner with
  every other XHR (the built-in Tabulator fetcher bypassed all three).
- **Edit dialogs** (`plans.js` / `zones.js`): Save/Delete listeners are wired
  once per mount (not per open) — per-open wiring silently lost the second edit's
  save and stacked duplicate delete confirmations.
- **Plan-user data race** (`views/modules/planuserdata.js`): a generation token
  drops a stale `getUsers` response from a previous plan on a fast plan→plan
  switch.
- **Boot resilience** (`app/bootstrap.js` + `app/main.js`): `bootstrap` is built
  on `lazyCache` + `Utils.xhr` (shares 401 redirect + spinner, retries on
  failure); `boot()` wraps the i18n+bootstrap awaits in try/catch and renders a
  retry view on failure (was a permanently blank app); plan/zone CRUD now call
  `bootstrap.refresh()` + `nav.render()` so the nav/prefs/calendar option lists
  invalidate without a page reload. The shell DOM-only inits (dropdowns/theme/
  triggers) are wired before the network awaits to close a dropdown-init race.
- **Stored XSS** (`groupAssign.js`): group name is set via `textContent`, not
  `innerHTML` (Polyglot's `TR()` does not escape interpolations).
- **Prefs dropdowns** (`app/modals/prefs.js`): all four `M.FormSelect.init` sites
  route through `initFormSelect` (destroy-then-init) so re-init no longer stacks
  `.select-wrapper`s.
- **`?return=` sanitization** (`app/routes.js` `safeReturn`): assign-view
  back-links validate `return` is a same-origin, route-matching path before
  writing it to `href` (rejects `javascript:` and open-redirect sinks).
- **Mount-prefix support** (the plan's stated design goal, now actually
  implemented): `app/routes.js` derives a router base path from
  `warpGlobals.URLs.users` and `matchRoute` strips it; `navigate()` prepends it
  for route-relative paths; `nav.js` / `index.js` consume the `spaURLs()` `plan`
  and `bookings` entries instead of hardcoded `/bookings` / `/plan/'+id`. A `plan`
  URL key was added to `spaURLs()` for this.
- **Backend admin stubs** (`warp/view.py`): the seven byte-identical admin 403+
  render stubs collapse to one `_admin_spa()` helper.
- **Backend sentinels via `warpGlobals`** (`warp/view.py` `spaGlobals`):
  `accountTypeGroup` (scalar) plus `zoneRoles` / `zoneTypes` maps are injected
  once and read in JS (e.g. `warpGlobals.zoneRoles.admin`) instead of being
  re-hardcoded as literals (users/groups/zones/zoneAssign).
- **Confirm dialog unification**: the three confirmations in `bookings.js` and
  `planModify.js` route through `lib/confirmDelete.js` instead of re-implementing
  the Yes/No `WarpModal` boilerplate (one used a third boolean-id idiom).
- **`confirmDelete` dismiss semantics**: Esc / outside-click now resolve `false`
  (treated as "no") so caller closures are released; the stale header comment
  that claimed an unhandled dismiss "never resolves" is corrected.
- **Lazy i18n at module load** (`views/modules/modal.js`):
  `WarpModal.default_options` no longer calls `TR()` at module-eval time — the
  default Ok button text is computed in `open()`. Pulling `utils.js → modal.js`
  into the eager boot graph (via `bootstrap.js` now importing `Utils`) would
  otherwise have thrown `TR is not defined` before `loadI18n()` resolves, since
  ES module imports evaluate before `boot()` runs.
- **e2e coverage of the client error view**: `tests/booking/access.spec.ts`
  gained a spec asserting `body[data-view="error"]` + `#view-error` on a
  forbidden plan deep link (the plan's §5 claim that deep-link 403/404
  assertions assert the client error view is now actually backed by a test).
- **Stale doc/comment cleanup**: references to deleted templates (`plan.html`,
  `base_logged.html`, `group_assign.html`, `zone_assign.html`) and `base.js`
  in `view.py`, `xhr/groups.py`, `xhr/zones.py`, `style.css`, `groupChips.js`;
  `zones.js` reassign-modal cleanup uses the dialog's `onCloseEnd` hook instead
  of a hardcoded 300 ms `setTimeout` that raced `router.replaceChildren`.

Not done (intentionally, reviewed and kept for correctness):
- **Serialization waterfalls** (plan.js `getContext` → `getSeats`/`getUsers`,
  assign-view name lookups, bookings-report `bookingsContext`): each await is
  correctness-ordered (context seeds per-plan globals; lookups drive the title /
  error view / initial filter window) or already fire-and-forget-concurrent —
  reordering risks correctness for a minor latency gain.
- **Client-side admin guard in the router**: the server remains the authority
  (admin deep-links still 403 on refresh); with table XHRs now routed through
  `Utils.xhr`, a mid-session demotion surfaces as the debounced 401→login
  redirect on the next request rather than a separate client guard.
- **Cross-language route-list mirror** (`view.py` ↔ `js/app/routes.js`): a
  shared single source would need codegen; the Python admin stubs were deduped
  and the lists are kept in sync by the `endpoints-coverage` spec.
