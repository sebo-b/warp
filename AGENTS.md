# AGENTS.md

Guiding principles and project map for AI coding agents working on WARP. It
complements (does not replace) the tracked docs in §2.

---

## 1. What WARP is

**WARP** — Workspace Autonomous Reservation Program. A hybrid-office desk (and
parking) reservation system: users book/cancel seats on floor maps, admins
manage maps, zones, groups and users. Flask backend (peewee + PostgreSQL),
hand-rolled SPA frontend (native ES modules + webpack), Materialize 2.x CSS,
native `<dialog>` modals. Installable as a PWA. Auth backends: built-in, LDAP,
Azure AD (MSAL), OIDC, SAML.

### Repo layout

```
warp/                 # Flask app package (the backend, Python)
  config.py           # all settings + WARP_ env-var parsing (single source of truth)
  db.py               # peewee models / ORM layer
  auth*.py            # auth backends (built-in, ldap, aad, oidc, saml, mellon)
  view.py             # server-rendered routes + SPA mount
  xhr/                # XHR API endpoints (bookings, plans, zones, users, groups, ...)
  sql/                # schema.sql + numbered migration_*.sql + sample_data.sql
  static/             # served assets
    theme.css         # COLOURS ONLY — see Themes/CSS
    i18n/             # en/de/fr/es/pl translation JSON
    dist/             # webpack output (GITIGNORED — never commit)
    sw.js             # PWA service worker
  templates/          # Jinja templates; headers/ is webpack HTML output (GITIGNORED)
js/                   # frontend source (JS, webpack → warp/static/dist/)
  base/style.css      # structural CSS (spacing, radius, M3 mappings)
  app/                # router.js, dialog.js (WarpDialog), modals/, i18n, theme, ...
  views/              # one module per admin/booking view
tests/                # pytest suite (pure-Python, no fixtures framework)
e2e/                  # Playwright browser suite (see §4)
containers/           # Dockerfile (prod), Dockerfile_debug (e2e), compose/, quadlet/
res/                  # demo gif, icons, check_i18n.py, perf/gen scripts
```

---

## 2. Tracked documentation

Version-controlled and authoritative — update them when behaviour changes
(see §5) and treat them as part of the codebase.

| Doc | Scope |
|-----|-------|
| [README.md](README.md) | overview, quick start, dev setup, container images |
| [FEATURES.md](FEATURES.md) | everything a user/tester/admin can do; basis for the e2e suite |
| [CONFIGURATION.md](CONFIGURATION.md) | every `warp/config.py` setting and `WARP_` env var |
| [GLOSSARY.md](GLOSSARY.md) | plain-language definitions (zone, plan, seat, assignment) |
| [PERMISSIONS.md](PERMISSIONS.md) | the authoritative access model |
| [AUTOBOOK.md](AUTOBOOK.md) | auto-book seat-picking heuristics — only relevant when changing the auto-book logic (`warp/xhr/plan.py`); no need to read it otherwise |
| [e2e/README.md](e2e/README.md) | e2e harness, how to run, test accounts, writing conventions |
| [containers/README.md](containers/README.md) | prod + debug images, compose, Podman Quadlet |

`PLAN_*.md` and `graphify-out/` are gitignored local working documents;
`CODE_REVIEW.md` is a working review log.

---

## 3. pytest (`tests/`)

Pure-Python unit tests for non-UI logic: SAML/OIDC metadata & routes, PWA,
group/zone mapping, timezone/time handling, calendar utils. No `conftest.py` /
fixtures framework — each `test_*.py` is standalone.

```sh
source .venv/bin/activate      # python venv (see README dev setup)
pip install -r requirements.txt
pytest                         # from repo root
pytest tests/test_pwa.py       # single file
```

The frontend build (`cd js && npm ci && npm run build`) is only needed to run
the app, not pytest.

External auth providers (LDAP / Azure AD / OIDC / SAML) can't be exercised by
the self-contained e2e container, so their behaviour relies on these unit tests
(`test_saml_*`, `test_oidc_*`, …); keep that coverage in step when touching
auth backends.

---

## 4. e2e tests (`e2e/`)

Browser-driven Playwright suite against the real UI, run in a self-contained
container built from `containers/Dockerfile_debug` (PostgreSQL + Flask debug)
which the harness builds and starts automatically. **Podman is available**
(preferred over docker when both exist; auto-detected).

```sh
cd e2e
npm ci
npx playwright install chromium
npm test                       # builds + starts the container automatically
npm run test:headed            # watch the browser
npm run test:ui                # Playwright UI mode
npx playwright test tests/booking.spec.ts   # single file
npm run test:officemap         # OfficeMap component suite — backend-free, own config, no container
npm run report                 # open last HTML report
```

See [`e2e/README.md`](e2e/README.md) for the full harness description. Key rules
that catch agents out:

- **e2e is e2e: drive the real UI** (click, type, navigate). Do not call the
  XHR/HTTP API directly. The only allowed backchannel is the **database** for
  test setup/reset and assertions on persisted state — and even that only when a
  real UI flow can't set up the precondition (e.g. seeding a specific row).
- Import `test`/`expect` from `../fixtures`, never from `@playwright/test`
  (the fixture resets the DB + virtual clock before each test).
- After SPA client-side nav, `waitForLoadState('networkidle')` is meaningless —
  use `helpers/spa.ts`'s `waitForViewReady(page, view?)`. Direct `page.goto()`
  still does a real load.
- Suite runs `workers: 1`, `fullyParallel: false` because all tests share one
  DB. Do not enable parallelism without giving each worker its own database.
- The DB reset replays `warp/sql/clean_db.sql` + `warp/sql/schema.sql` + a
  **frozen** `e2e/sql/sample_data.sql`. If you change values in
  `warp/sql/sample_data.sql` that e2e asserts on, sync `e2e/sql/` too.
- Follow the writing conventions in `e2e/README.md`: one feature area per spec
  file in `tests/`, reusable interactions in `helpers/`, test users from
  `helpers/users.ts`, user-facing locators over CSS.
- `containers/Dockerfile_debug` is for demos/e2e only — never deploy it
  (Werkzeug debugger, hard-coded Postgres password, `/debug/*` auth bypass,
  auto-reset state); production runs `containers/Dockerfile` (uWSGI, no DB)
  behind a reverse proxy.

---

## 5. Working principles

### Branching

- For non-trivial changes create a `feature/`, `chore/`, or `fix/` branch.
- **If the request or plan does not clearly state which to use, ask the user
  for confirmation before branching** — do not assume.

### Code style

- Clean architecture, no magic numbers, single source of truth — **where
  applicable** — but YAGNI first: the first lazy solution that works is the
  right one. No speculative abstraction, no interface with one implementation,
  no scaffolding "for later". Deletion over addition; a one-liner stays a
  one-liner.
- Non-trivial logic leaves behind the smallest runnable check that fails if the
  logic breaks (an `assert`-based self-check / one small test). Trivial
  one-liners need no test.
- **`warp/config.py` is the single source for configuration.** Every setting
  has a `WARP_` env-var override; type is inferred from the setting, not the
  value. Don't read config from ad-hoc env vars or duplicate defaults in JS —
  the SPA derives the mount prefix etc. from `window.warpGlobals.URLs` rather
  than hardcoding paths.
- **SPA routing is hand-rolled** (`js/app/router.js`, `routes.js`). No
  wildcard patterns — `routes.js` is a small explicit registry. A new route
  gets one entry there; a path that matches nothing renders the client
  `#view-error` view, not a server 500.
- **Auth backends are pluggable and independent.** A change to one of
  `auth_ldap`/`auth_aad`/`auth_oidc`/`auth_saml`/`auth_mellon` should not bleed
  into another.

### Themes / CSS

- `warp/static/theme.css` is **pure colour** — the single source of truth for
  colours and nothing else. Structural CSS lives in `js/base/style.css`.
- **Do not introduce new colours or new `--warp-*` CSS variables in
  `theme.css` without explicit permission.**

### Plans vs implementation

- If the user asks for a **plan**, a **check**, or a **recommendation**, that
  is *literally* what they want — analysis/outline, not code changes. You may
  *offer* to implement afterwards, but don't jump to it.
- A plan is not implementation: in general it should **not** contain
  ready-to-paste code snippets.

### Committing & pushing

- **Do not push without a clear order from the user.**
- When asked to commit, attribute yourself with a `Co-Authored-By:` trailer
  under your own agent identity (name + email). Examples:
    - Co-Authored-By: Claude Fable 5 <claude@anthropic.com>
    - Co-Authored-By: Claude Opus 4.8 <claude@anthropic.com>
    - Co-Authored-By: Claude Sonnet 5 <claude@anthropic.com>
    - Co-Authored-By: GLM 5.2 <glm-5.2@z.ai>
    - Co-Authored-By: Grok Build 0.1 <noreply@x.ai>
    - Co-Authored-By: Kimi Code 2.7 <noreply@moonshot.ai>
- Never `git add` gitignored artifacts: `warp/static/dist/`,
  `warp/templates/headers/`, `PLAN_*.md`, `graphify-out/`.

### Testing cadence

- Run partial tests (relevant specs / pytest files) freely; run full e2e when
  the change warrants it.
- A full e2e run takes a long time — **if unsure whether one is needed, ask the
  user** instead of starting it.
- Before a push, full e2e must have been run; if it hasn't, run it.

### Documentation

- After implementation, update the relevant tracked `.md` files — **especially
  when a new configuration** (setting/env var) is introduced, update
  [CONFIGURATION.md](CONFIGURATION.md); new user-facing behaviour updates
  [FEATURES.md](FEATURES.md).
- If e2e tests need updating to not fail (e.g. new endpoints, which the suite
  detects), update them. New functionality must be covered by e2e.
- If a bug is raised and fixed that was **not** caught by e2e or pytest,
  investigate the gap and extend test coverage so it would be caught next time.

### Consistency & bug spread

- Consistency matters: if something is changed or added, offer to apply the
  same change to other places that are consistently the same (e.g. a change in
  one modal dialog should be reflected across all modal dialogs).
- The same applies to bugs: when fixing a bug, check whether the same issue
  affects other parts of the code and fix/prevent there too.

### Modal dialogs

- All modals go through the unified `WarpDialog` controller (`js/app/dialog.js`):
  button order, dirty-guard behaviour, Esc/outside-click dismissal rules, select
  dropdown escaping. **This unification must be preserved** — don't hand-roll
  modal lifecycle or dismissal in individual views.

### i18n

- UI strings are client-side and multi-locale: the `TR` class + keys resolved
  from `warp/static/i18n/{en,de,fr,es,pl}.json` (`en` is the reference).
- **New user-facing text must be added to all five locale files**, in the same
  key position in every file — locale files stay consistent in keys and key
  order so they diff cleanly.
- When text is removed and not used elsewhere, remove its key from **all**
  locale files — no stale/unused keys.
- `res/check_i18n.py` validates that every locale defines exactly the same key
  set as `en`. Run it after i18n edits: `python3 res/check_i18n.py`.

### Database access & schema

- **Prefer peewee over raw SQL.** Database access goes through peewee
  models/queries in `warp/db.py` and the `xhr/` handlers; reach for raw
  `SQL(...)`/`execute_sql` only when peewee genuinely can't express what you
  need (existing uses are DB-engine primitives like `make_interval` / `AT TIME
  ZONE` casts, and the migration runner itself). Don't hand-write `SELECT`/
  `INSERT`/`UPDATE` that peewee could build.
- **Schema is versioned and migrated in lockstep.** The full build is
  `warp/sql/schema.sql` — its final lines write the current version into the
  `db_initialized` table (now `18`). The delta path is numbered
  `warp/sql/migration_NNN_*.sql` files **registered** in the `DB_MIGRATIONS`
  list in `warp/db.py` (which runs them in order, up to the tracked version). A
  schema change must update **all three** together: add the change to
  `schema.sql`, bump its `INSERT INTO db_initialized` version, write a new
  `migration_NNN_*.sql`, and append a matching `(NNN, "...")` entry in
  `DB_MIGRATIONS`. App and e2e share the same SQL scripts, so they can never
  disagree on structure.
