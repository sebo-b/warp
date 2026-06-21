// The screen catalogue: a declarative, ordered list driving both capture and
// the report rows. Adding a screen is a one-line change here.
//
// Dynamic ids (pid/zid/group_login) are resolved from the seeded DB via the
// `sql()` resolver — no hardcoded ids. (The plan said "prefer xhr JSON over
// DOM scraping"; a direct SQL read against the seeded tables is even more
// deterministic and already available via the imported db helper, so we use
// that. The spirit — never hardcode ids — is preserved.)

import type { Page } from '@playwright/test';

export type Role = 'anon' | 'admin' | 'user';

export interface ResolveCtx {
  /** Run a SQL query against the sandbox DB, return rows. */
  sql: (text: string) => Promise<{ rows: Record<string, unknown>[] }>;
}

export interface Screen {
  /** Stable file/row key, e.g. "plans-modify". */
  id: string;
  /** Human label in the report. */
  title: string;
  role: Role;
  /** Static path or id-resolving path. */
  path: (ctx: ResolveCtx) => Promise<string> | string;
  /** Open a modal/dropdown/tab before the shot (optional). */
  prepare?: (page: Page) => Promise<void>;
  /** Per-screen viewport override (default desktop). */
  viewport?: { width: number; height: number };
  /** Full-page screenshot (default true). */
  fullPage?: boolean;
}

// --- id resolvers (cached after first resolve per run) -----------------------

async function firstPid(ctx: ResolveCtx): Promise<number> {
  const { rows } = await ctx.sql('SELECT id FROM plan ORDER BY id LIMIT 1');
  return Number(rows[0].id);
}
async function firstZid(ctx: ResolveCtx): Promise<number> {
  const { rows } = await ctx.sql('SELECT id FROM zone ORDER BY id LIMIT 1');
  return Number(rows[0].id);
}
async function firstGroupLogin(ctx: ResolveCtx): Promise<string> {
  const { rows } = await ctx.sql("SELECT login FROM users WHERE account_type = 100 ORDER BY login LIMIT 1");
  return String(rows[0].login);
}

// --- prepare helpers (Materialize modals/dropdowns/sidenav) ------------------

/** Open the add/edit user modal on /users (the FAB is an <a>, not a button). */
async function openUserModal(page: Page): Promise<void> {
  await page.locator('#add_user_btn').click();
  // The modal opens only after an autocomplete-data XHR resolves.
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
}

/** Open the zone edit modal on /zones. */
async function openZoneModal(page: Page): Promise<void> {
  await page.locator('#add_zone_btn').click();
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
}

/** Open the plan add modal on /plans. */
async function openPlanModal(page: Page): Promise<void> {
  await page.locator('#add_plan_btn').click();
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
}

/** Open the group add modal on /groups. */
async function openGroupModal(page: Page): Promise<void> {
  await page.locator('#add_user_btn').click();
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
}

/** Open the "add to group" modal on /groups/assign/:login. */
async function openAddToGroupModal(page: Page): Promise<void> {
  await page.locator('#add_to_group_btn').click();
  await page.locator('#add_to_group_modal').waitFor({ state: 'visible' });
}

/** Open the "assign to zone" modal on /zones/assign/:zid. */
async function openAssignToZoneModal(page: Page): Promise<void> {
  await page.locator('#assign_to_zone_btn').click();
  await page.locator('#assign_to_zone_modal').waitFor({ state: 'visible' });
}

/** Open the seat action modal on /plan/:pid by clicking the first seat. */
async function openSeatActionModal(page: Page): Promise<void> {
  await page.locator('#zonemap div[style*="background-image"]').first().click();
  await page.locator('#action_modal').waitFor({ state: 'visible' });
}

/** Open the assigned-seat modal from the seat action modal (admin only). */
async function openAssignedSeatModal(page: Page): Promise<void> {
  await openSeatActionModal(page);
  await page.locator('#action_modal .zone_action_btn[data-action="assign-modal"]').click();
  await page.locator('#assigned_seat_modal').waitFor({ state: 'visible' });
}

/** Open the zone-map help modal on /plan/:pid. */
async function openZoneHelpModal(page: Page): Promise<void> {
  await page.locator('.zonemap_help').click();
  await page.locator('#zonemap_help_modal').waitFor({ state: 'visible' });
}

/** Open the mobile sidenav (mobile viewport expected). */
async function openSidenav(page: Page): Promise<void> {
  await page.locator('.sidenav-trigger').first().click();
  await page.locator('#mobile-nav').waitFor({ state: 'visible' });
}

/** Open the desktop nav user-menu dropdown (the person icon). */
async function openUserMenuDropdown(page: Page): Promise<void> {
  await page.locator('.dropdown-trigger[data-target="user_menu_dropdown"]').click();
  await page.locator('#user_menu_dropdown').waitFor({ state: 'visible' });
}

/** Open the desktop nav admin-menu dropdown (the settings icon). */
async function openAdminMenuDropdown(page: Page): Promise<void> {
  await page.locator('.dropdown-trigger[data-target="admin_menu_dropdown"]').click();
  await page.locator('#admin_menu_dropdown').waitFor({ state: 'visible' });
}

/** Open the Preferences modal via the user menu (pref_timeslider + selects + switches). */
async function openPrefsModal(page: Page): Promise<void> {
  await openUserMenuDropdown(page);
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /preferences/i }).click();
  await page.locator('#pref_modal').waitFor({ state: 'visible' });
}

/** Open the Calendar integration modal via the user menu (chips + selects + timepicker). */
async function openCalendarModal(page: Page): Promise<void> {
  await openUserMenuDropdown(page);
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /calendar integration/i }).click();
  await page.locator('#calendar_modal').waitFor({ state: 'visible' });
  // Reminder selects + chips are populated by XHR after open.
  await page.waitForLoadState('networkidle');
}

/** Open the Change password modal via the user menu. */
async function openChangePasswordModal(page: Page): Promise<void> {
  await openUserMenuDropdown(page);
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /change password/i }).click();
  await page.locator('#change_password_modal').waitFor({ state: 'visible' });
}

/** Open the Materialize timepicker clock from the Calendar modal (the date/time selector). */
/** Open the Materialize Datepicker (the "calendar widget") used as a Tabulator
 *  header filter on the bookings pages. The datepicker inputs are created
 *  dynamically inside header-filter cells; a plain click only inits the modal,
 *  so drive the Materialize instance directly. */
async function openDatepicker(page: Page): Promise<void> {
  await page.locator('.tabulator-header-filter input').first().waitFor({ state: 'attached' });
  // 2.x: the modal calendar (displayPlugin:'modal') opens on input interaction.
  // inst.open() is deprecated/no-op, and the open dialog uses the [open]
  // attribute, not a .open class.
  await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('.tabulator-header-filter input')) as HTMLElement[];
    for (const inp of inputs) {
      if ((window as any).M?.Datepicker?.getInstance(inp)) {
        inp.scrollIntoView({ block: 'center' });
        inp.focus();
        inp.click();
        return;
      }
    }
    throw new Error('no Materialize Datepicker found in tabulator header filters');
  });
  await page.locator('.datepicker-modal[open]').first().waitFor({ state: 'visible' });
}

/** Open a Materialize FormSelect dropdown inside the Preferences modal.
 *  The default-plan select is initialized when the modal opens; opening it
 *  shows the Materialize dropdown chrome (which 2.x restyles). */
async function openPrefSelect(page: Page): Promise<void> {
  await page.locator('.dropdown-trigger[data-target="user_menu_dropdown"]').click();
  await page.locator('#user_menu_dropdown').getByRole('link', { name: /preferences/i }).click();
  await page.locator('#pref_modal').waitFor({ state: 'visible' });
  await page.locator('#pref_modal .select-wrapper input').first().click();
  await page.locator('.dropdown-content.select-dropdown').first().waitFor({ state: 'visible' });
}

// --- the catalogue ----------------------------------------------------------

export const SCREENS: Screen[] = [
  // Anonymous
  { id: 'login', title: 'Login form', role: 'anon', path: '/login' },
  { id: 'login-error', title: 'Login error', role: 'anon',
    path: '/login',
    async prepare(page) {
      await page.getByLabel('Login').fill('admin');
      await page.getByLabel('Password').fill('wrong-password');
      await page.locator('button[type=submit]').click();
      // auth_error.html is rendered on failed login.
    },
  },

  // Admin
  { id: 'index', title: 'Home (admin)', role: 'admin', path: '/' },
  { id: 'bookings', title: 'Bookings list', role: 'admin', path: '/bookings' },
  { id: 'bookings-report', title: 'Bookings report', role: 'admin', path: '/bookings/report' },
  { id: 'zone', title: 'Seat-map booking view', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plan/${pid}`) },
  { id: 'plan-book-as', title: 'Book-as input in plan sidepanel', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plan/${pid}`), fullPage: false },
  { id: 'plans', title: 'Plans list', role: 'admin', path: '/plans' },
  { id: 'plans-modify', title: 'Zone-map editor', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plans/modify/${pid}`) },
  { id: 'zones', title: 'Zones list', role: 'admin', path: '/zones' },
  { id: 'zones-assign', title: 'Zone assign', role: 'admin',
    path: (ctx) => firstZid(ctx).then((zid) => `/zones/assign/${zid}`) },
  { id: 'users', title: 'Users list', role: 'admin', path: '/users' },
  { id: 'groups', title: 'Groups list', role: 'admin', path: '/groups' },
  { id: 'groups-assign', title: 'Group assign', role: 'admin',
    path: (ctx) => firstGroupLogin(ctx).then((g) => `/groups/assign/${g}`) },

  // Component states (2.x changes component chrome)
  { id: 'modal-add-user', title: 'Modal: add user', role: 'admin',
    path: '/users', prepare: openUserModal, fullPage: false },
  { id: 'modal-zone-edit', title: 'Modal: zone edit', role: 'admin',
    path: '/zones', prepare: openZoneModal, fullPage: false },
  { id: 'modal-plan-add', title: 'Modal: plan add', role: 'admin',
    path: '/plans', prepare: openPlanModal, fullPage: false },
  { id: 'modal-group-add', title: 'Modal: group add', role: 'admin',
    path: '/groups', prepare: openGroupModal, fullPage: false },
  { id: 'modal-group-assign', title: 'Modal: add to group', role: 'admin',
    path: (ctx) => firstGroupLogin(ctx).then((g) => `/groups/assign/${g}`),
    prepare: openAddToGroupModal, fullPage: false },
  { id: 'modal-zone-assign', title: 'Modal: assign to zone', role: 'admin',
    path: (ctx) => firstZid(ctx).then((zid) => `/zones/assign/${zid}`),
    prepare: openAssignToZoneModal, fullPage: false },
  { id: 'modal-seat-action', title: 'Modal: seat action', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plan/${pid}`),
    prepare: openSeatActionModal, fullPage: false },
  { id: 'modal-assigned-seat', title: 'Modal: assigned seat', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plan/${pid}`),
    prepare: openAssignedSeatModal, fullPage: false },
  { id: 'modal-zonemap-help', title: 'Modal: zone map help', role: 'admin',
    path: (ctx) => firstPid(ctx).then((pid) => `/plan/${pid}`),
    prepare: openZoneHelpModal, fullPage: false },
  { id: 'sidenav', title: 'Sidenav (mobile)', role: 'admin',
    path: '/',
    prepare: openSidenav,
    viewport: { width: 390, height: 844 }, fullPage: false },
  { id: 'select-open', title: 'FormSelect dropdown open', role: 'admin',
    path: '/', prepare: openPrefSelect, fullPage: false },

  // Nav dropdowns (Materialize dropdown chrome — 2.x restyles)
  { id: 'dropdown-user-menu', title: 'Nav dropdown: user menu', role: 'admin',
    path: '/', prepare: openUserMenuDropdown, fullPage: false },
  { id: 'dropdown-admin-menu', title: 'Nav dropdown: admin menu', role: 'admin',
    path: '/', prepare: openAdminMenuDropdown, fullPage: false },

  // Date / time selectors
  { id: 'modal-prefs', title: 'Preferences modal (time slider + selects)', role: 'admin',
    path: '/', prepare: openPrefsModal, fullPage: false },
  { id: 'modal-calendar', title: 'Calendar modal (chips + selects + timepicker)', role: 'admin',
    path: '/', prepare: openCalendarModal, fullPage: false },
  { id: 'modal-change-password', title: 'Change password modal', role: 'admin',
    path: '/', prepare: openChangePasswordModal, fullPage: false },

  // Calendar widget (Materialize Datepicker) — used as a Tabulator header filter
  // on the bookings pages (Time column on /bookings; From/To on /bookings/report).
  { id: 'bookings-datepicker', title: 'Datepicker calendar open (bookings filter)', role: 'admin',
    path: '/bookings', prepare: openDatepicker, fullPage: false },

  // User
  { id: 'user-index', title: 'Home (user)', role: 'user', path: '/' },
];

/** Catalogue order = report row order (stable across runs). */
export const CATALOGUE_ORDER: string[] = SCREENS.map((s) => s.id);