# warp end-to-end tests

Browser-driven e2e tests for warp using [Playwright](https://playwright.dev/).
Tests interact with the real UI (click, type, navigate) against a self-contained
container built from `Dockerfile_debug` — they must **not** call the XHR API
directly. The only allowed backchannel is the database (test setup, reset,
assertions on persisted state).

## Quick start

```sh
cd e2e
npm ci
npx playwright install chromium
npm test                 # builds + starts the podman container automatically
```

Useful variants:

```sh
npm run test:headed      # watch the browser
npm run test:ui          # Playwright UI mode (best for writing tests)
npx playwright test tests/login.spec.ts   # single file
npm run report           # open last HTML report
```

## How the harness works

- **App under test**: `Dockerfile_debug` builds a single Alpine image running
  both PostgreSQL (port 5432) and `flask --app=warp --debug run` (port 5000).
  Debug mode selects `DevelopmentSettings` in `warp/config.py`, which on every
  flask start wipes the DB (`sql/clean_db.sql`), applies `sql/schema.sql`, and
  loads `sql/sample_data.sql`.
- **`global-setup.ts`**: if nothing answers on `http://127.0.0.1:5000/login`,
  it runs `<engine> build -f containers/Dockerfile_debug -t warp-e2e .` and
  starts a container named `warp-e2e` publishing 5000 and 5432. If a server is
  already up it reuses it (and teardown leaves it alone). The container engine
  is auto-detected: `podman` is used if it is on `$PATH`, otherwise `docker`.
  Override with `E2E_CONTAINER_ENGINE=docker` (or any other engine); override
  the target URL with `E2E_BASE_URL`.
- **`global-teardown.ts`**: removes the container only if setup started it
  (tracked via the `.container-started-by-setup` marker file).
- **DB reset** (`helpers/db.ts`): `resetDb()` connects to
  `postgres:postgres_password@127.0.0.1:5432/postgres` (matching the
  `DevelopmentSettings` component defaults — `DATABASE_ADDRESS`,
  `DATABASE_NAME`, `DATABASE_USER`, `DATABASE_PASSWORD`) and replays
  `warp/sql/clean_db.sql` + `warp/sql/schema.sql` (the app's own structural
  scripts — they ARE the schema, so app and tests can never disagree on
  structure) followed by **`e2e/sql/sample_data.sql`**. `sample_data.sql` is
  demo seed data that may be edited in `warp/sql/` for demo/marketing reasons;
  the e2e suite owns a frozen snapshot under `e2e/sql/` so assertions on
  specific values (test logins, "Zone 1A", seat "1.1", …) stay stable. The app
  still loads its own copy at first start; `resetDb()` overrides it before
  every test. `querySql()` is the escape hatch for custom setup or asserting
  persisted state.
- **`fixtures.ts`**: exports `test`/`expect` with an `auto` fixture that calls
  `resetDb()` and zeroes the debug time offset before every test. **Always
  import `test` and `expect` from `../fixtures`, never from
  `@playwright/test`**, or your test will inherit whatever data the previous
  test left behind.
- **Virtual time** (`helpers/debug.ts`): `setTimeOffset`/`advanceDays` shift
  the server clock through the debug-only `/debug/set_time_offset` endpoint.
  The offset is process-global flask state — the fixture resets it before each
  test, so no manual cleanup is needed. Mind that jumping forward by a day or
  more expires every login session (`SESSION_LIFETIME`): log in again after
  advancing the clock, or `/xhr/*` calls silently redirect to `/login`.
- Because all tests share one database, the config pins `workers: 1` and
  `fullyParallel: false`. Do not turn parallelism on without giving each
  worker its own database.

## Test accounts (from `warp/sql/schema.sql` + `e2e/sql/sample_data.sql`)

| login   | password        | role                       |
|---------|-----------------|----------------------------|
| `admin` | `noneshallpass` | admin (account_type 10)    |
| `user1` | `password`      | regular user, display name Foo |
| `user2` | `password`      | regular user, display name Bar |
| `user3` | `password`      | regular user, display name Baz |

`group_1a`, `group_1b`, `group_parking` are groups (account_type 100) and
cannot log in. Sample data also defines zones 1–3 ("Zone 1", "Zone 2",
"Parking") with seats and zone assignments — see `e2e/sql/sample_data.sql`.

## Conventions for writing new tests

- One feature area per spec file in `tests/` (e.g. `login.spec.ts`,
  `booking.spec.ts`, `users-admin.spec.ts`).
- Put reusable page interactions in `helpers/` (or promote to page objects in
  `pages/` once a flow is used by 3+ specs). `helpers/auth.ts` has
  `logIn`/`logOut`/`expectLoggedIn`.
- Test users live in `helpers/users.ts`; don't hardcode credentials in specs.
- Prefer user-facing locators (`getByLabel`, `getByRole`, visible text) over
  CSS selectors where possible.

## UI quirks worth knowing (read before writing selectors)

- **Client-side i18n**: elements carrying class `TR` get their text replaced
  by JS at load time (`warp/static/i18n/en.json`). Raw template text like
  `btn.Login` is a translation key — match the *translated* text, or use a
  structural locator (e.g. `button[type=submit]`) when the key/translation is
  ambiguous.
- **Materialize CSS**: the UI uses Materialize. `<select>` elements are
  replaced by JS dropdowns (the native select is hidden — click the rendered
  `.select-wrapper input` instead), and modals animate (use auto-waiting
  `expect(...).toBeVisible()` rather than fixed sleeps).
- **Tabulator tables**: admin lists (Users, Groups, Zones) are rendered by
  Tabulator. Rows are `.tabulator-row`, cells `.tabulator-cell`; inline cell
  editing happens through dynamically created inputs.
- **Logged-in marker**: `#mobile-nav` only exists in `base_logged.html`;
  `expectLoggedIn()` relies on it.
- The flask server runs with `--debug`; a request that raises shows the
  Werkzeug debugger page instead of a plain 500 — screenshots in
  `test-results/` will make that obvious.

## Suggested next tests (not yet written)

- Admin user management (create user, block user → login refused).
- Zone group autocomplete (migration 010, text-based zone_group).
- Password change from the user menu (min length validation).
