/**
 * Super-admin tests: page access control + user management.
 */
import { test, expect } from '../../fixtures';
import { logIn, logOut } from '../../helpers/auth';
import { ADMIN, USER1, USER2 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { TAB, adminPost, createUser } from '../../helpers/admin';

test.describe('admin page access control', () => {

  for (const path of ['/users', '/groups', '/zones', '/bookings/report']) {
    test(`admin can access ${path}`, async ({ page }) => {
      await logIn(page, ADMIN);
      const resp = await page.request.get(path);
      expect(resp.status()).toBe(200);
    });

    test(`regular user is forbidden from ${path}`, async ({ page }) => {
      await logIn(page, USER1);
      const resp = await page.request.get(path);
      expect(resp.status()).toBe(403);
    });
  }

  test('admin sees settings icon and admin nav links in the header', async ({ page }) => {
    await logIn(page, ADMIN);
    await page.goto('/');
    // The settings icon opens the admin dropdown
    await expect(page.locator('nav .dropdown-trigger[data-target="admin_menu_dropdown"]')).toBeVisible();
    // Open the dropdown and verify links inside
    await page.locator('nav .dropdown-trigger[data-target="admin_menu_dropdown"]').click();
    await expect(page.locator('#admin_menu_dropdown a', { hasText: 'Users' })).toBeVisible();
    await expect(page.locator('#admin_menu_dropdown a', { hasText: 'Zones' })).toBeVisible();
  });

  test('regular user does not see admin settings icon', async ({ page }) => {
    await logIn(page, USER2);
    await page.goto('/');
    await expect(page.locator('nav .dropdown-trigger[data-target="admin_menu_dropdown"]')).toHaveCount(0);
  });

});

test.describe('user management', () => {

  test('admin can list all users', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/list', TAB);
    expect(resp.status()).toBe(200);
    const logins = (await resp.json()).data.map((u: any) => u.login);
    expect(logins).toContain('user1');
    expect(logins).toContain('user2');
    expect(logins).toContain('admin');
  });

  test('admin can create a new regular user', async ({ page }) => {
    await logIn(page, ADMIN);
    await createUser(page, 'newuser', 'New User');

    const result = await querySql(
      'SELECT login, name, account_type FROM users WHERE login = $1',
      ['newuser'],
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('New User');
    expect(Number(result.rows[0].account_type)).toBe(20);
  });

  test('new user can log in with the provided password', async ({ page }) => {
    await logIn(page, ADMIN);
    await createUser(page, 'newuser', 'New User', 20, 'freshpassword');
    await logOut(page);

    await logIn(page, { login: 'newuser', password: 'freshpassword', name: 'New User' });
    await expect(page.locator('#mobile-nav')).toBeAttached();
  });

  test('admin can create a group account (no password)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'add', login: 'newgroup', name: 'New Group', account_type: 100,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT account_type FROM users WHERE login = $1', ['newgroup']);
    expect(Number(result.rows[0].account_type)).toBe(100);
  });

  test('admin can update a user display name', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'update', login: 'user2', name: 'Updated Bar', account_type: 20,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT name FROM users WHERE login = $1', ['user2']);
    expect(result.rows[0].name).toBe('Updated Bar');
  });

  test('admin can block a user (account_type = 90)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'update', login: 'user2', name: 'Bar', account_type: 90,
    });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT account_type FROM users WHERE login = $1', ['user2']);
    expect(Number(result.rows[0].account_type)).toBe(90);
  });

  test('blocked user cannot log in', async ({ page }) => {
    await querySql('UPDATE users SET account_type = 90 WHERE login = $1', ['user2']);

    await logIn(page, USER2);
    await expect(page.locator('.flash_message')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test('admin can unblock a user', async ({ page }) => {
    await querySql('UPDATE users SET account_type = 90 WHERE login = $1', ['user2']);

    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/users/edit', { action: 'update', login: 'user2', name: 'Bar', account_type: 20 });
    await logOut(page);

    await logIn(page, USER2);
    await expect(page.locator('#mobile-nav')).toBeAttached();
  });

  test('admin can delete a user with no past bookings', async ({ page }) => {
    await logIn(page, ADMIN);
    await createUser(page, 'todelete', 'To Delete');

    const resp = await adminPost(page, '/xhr/users/delete', { login: 'todelete' });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM users WHERE login = $1', ['todelete']);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('deleting a user with past bookings without force returns 406 (code 173)', async ({ page }) => {
    const [seat] = (await (await import('../../helpers/booking')).getZoneSeats(1));
    const yesterday = (await import('../../helpers/booking')).futureDayTs(-1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seat.id, yesterday + 9 * 3600, yesterday + 17 * 3600],
    );

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/delete', { login: 'user2' });
    expect(resp.status()).toBe(406);
    expect((await resp.json()).code).toBe(173);
  });

  test('force-deleting a user removes them and their past bookings', async ({ page }) => {
    const { getZoneSeats, futureDayTs } = await import('../../helpers/booking');
    const [seat] = await getZoneSeats(1);
    const yesterday = futureDayTs(-1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seat.id, yesterday + 9 * 3600, yesterday + 17 * 3600],
    );

    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/delete', { login: 'user2', force: true });
    expect(resp.status()).toBe(200);

    const result = await querySql('SELECT COUNT(*)::int AS cnt FROM users WHERE login = $1', ['user2']);
    expect(result.rows[0].cnt).toBe(0);
  });

  test('duplicate login returns 400 (code 155)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'add', login: 'user1', name: 'Duplicate', account_type: 20,
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(155);
  });

  test('reserved EVERYONE_KEY login is rejected (code 157)', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'add',
      login: '__everyone__:550e8400-e29b-41d4-a716-446655440000',
      name: 'Everyone',
      account_type: 20,
    });
    expect(resp.status()).toBe(400);
    expect((await resp.json()).code).toBe(157);
  });

  test('non-admin cannot create a user (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'add', login: 'hacker', name: 'Hacker', account_type: 20,
    });
    expect(resp.status()).toBe(403);
  });

  test('non-admin cannot delete a user (403)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await adminPost(page, '/xhr/users/delete', { login: 'user1' });
    expect(resp.status()).toBe(403);
  });

  test("admin can fetch a user's group memberships", async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await page.request.get('/xhr/users/groups/user1');
    expect(resp.status()).toBe(200);
    const groupLogins = (await resp.json()).map((g: any) => g.login);
    expect(groupLogins).toContain('group_1b');
  });

  test('admin can set group memberships when editing a user', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/users/edit', {
      action: 'update', login: 'user3', name: 'Baz', account_type: 20, groups: ['group_1a'],
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      "SELECT COUNT(*)::int AS cnt FROM groups WHERE login = 'user3' AND \"group\" = 'group_1a'",
      [],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

});
