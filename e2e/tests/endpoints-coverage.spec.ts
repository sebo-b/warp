import { test, expect } from '../fixtures';

/**
 * The canonical list of endpoints known to have e2e test coverage.
 *
 * HOW TO USE THIS LIST
 * --------------------
 * If CI fails here it means either:
 *   - a new Flask route was registered but has no entry below — before adding it
 *     to this list, write at least one Playwright test that exercises it; or
 *   - an entry below no longer matches any registered route (a stale entry left
 *     behind after a route was renamed or removed) — delete it.
 *
 * Rules must match exactly what Flask reports (angle-bracket params included,
 * e.g. "/plan/<pid>" not "/plan/:pid").
 */
const COVERED_ENDPOINTS: ReadonlySet<string> = new Set([
  // auth
  '/change_password',
  '/login',
  '/logout',

  // iCal
  '/calendar/<login>/book',
  '/calendar/<login>/delete',
  '/calendar/<login>/events.ics',
  '/calendar/cancelled',

  // views
  '/',
  '/bookings',
  '/bookings/<string:report>',
  '/groups',
  '/groups/assign/<group_login>',
  '/users',
  '/plan/<pid>',
  '/plan/image/<pid>',
  '/plans',
  '/plans/modify/<pid>',
  '/zones',
  '/zones/assign/<zid>',

  // xhr — bookings
  '/xhr/bookings/list',
  '/xhr/bookings/report',

  // xhr — zone (booking operations)
  '/xhr/plan/apply',
  '/xhr/plan/autoBook/<int:pid>',
  '/xhr/plan/getSeats/<int:pid>',
  '/xhr/plan/getUsers/<int:pid>',

  // xhr — plans (plan + seat management)
  '/xhr/plans/addoredit',
  '/xhr/plans/allZones',
  '/xhr/plans/delete',
  '/xhr/plans/getSeats/<int:pid>',
  '/xhr/plans/list',
  '/xhr/plans/modify',
  '/xhr/plans/timezones',
  '/xhr/plans/zonesForPlan',

  // xhr — users
  '/xhr/users/delete',
  '/xhr/users/edit',
  '/xhr/users/groups/<login>',
  '/xhr/users/list',

  // xhr — groups
  '/xhr/groups/assign',
  '/xhr/groups/members',

  // xhr — zones (zone access management)
  '/xhr/zones/addoredit',
  '/xhr/zones/assign',
  '/xhr/zones/delete',
  '/xhr/zones/groups',
  '/xhr/zones/list',
  '/xhr/zones/members',
  '/xhr/zones/names',

  // xhr — prefs & calendar settings
  '/xhr/prefs',
  '/xhr/calendar',

  // xhr — SPA shell bootstrap (hit by every page load once logged in)
  '/xhr/bootstrap',

  // xhr — SPA per-view context (group/zone name lookup for the assign views)
  '/xhr/groups/info/<login>',
  '/xhr/zones/info/<int:zid>',

  // xhr — SPA per-view context, added as each view is converted
  // (PLAN_SPA_REFACTOR.md work packages 6-7): '/xhr/plan/getContext/<int:pid>'
  // (WP7), '/xhr/bookings/context' (WP6).
]);

test('all registered endpoints are covered by e2e tests', async ({ request }) => {
  const response = await request.get('/debug/endpoints');
  expect(response.ok(), `GET /debug/endpoints returned HTTP ${response.status()}`).toBe(true);

  const endpoints: { rule: string; endpoint: string }[] = await response.json();
  const registered = new Set(endpoints.map((e) => e.rule));

  const uncovered = [...registered].filter((rule) => !COVERED_ENDPOINTS.has(rule));
  expect(
    uncovered,
    `New endpoint(s) found with no e2e coverage.\n` +
    `Add a Playwright test for each, then register the URL rule in\n` +
    `COVERED_ENDPOINTS in e2e/tests/endpoints-coverage.spec.ts:\n` +
    uncovered.map((r) => `  '${r}',`).join('\n'),
  ).toHaveLength(0);

  const stale = [...COVERED_ENDPOINTS].filter((rule) => !registered.has(rule));
  expect(
    stale,
    `COVERED_ENDPOINTS lists endpoint(s) that are no longer registered.\n` +
    `Remove these stale entries from\n` +
    `COVERED_ENDPOINTS in e2e/tests/endpoints-coverage.spec.ts:\n` +
    stale.map((r) => `  '${r}',`).join('\n'),
  ).toHaveLength(0);
});
