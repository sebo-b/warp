import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN, USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { TAB, adminPost } from '../../helpers/admin';

test.describe('group management', () => {

  test('admin can list members of a group', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/groups/members', { ...TAB, groupLogin: 'group_1a' });
    expect(resp.status()).toBe(200);
    const logins = (await resp.json()).data.map((m: any) => m.login);
    expect(logins).toContain('user2');
  });

  test('admin can add a user to a group', async ({ page }) => {
    await logIn(page, ADMIN);
    const resp = await adminPost(page, '/xhr/groups/assign', { groupLogin: 'group_1a', add: ['user3'] });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      "SELECT COUNT(*)::int AS cnt FROM groups WHERE login = 'user3' AND \"group\" = 'group_1a'",
      [],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

  test('group membership grants zone access to the new member', async ({ page }) => {
    await querySql("INSERT INTO groups (login, \"group\") VALUES ('user3', 'group_1a')", []);

    await logIn(page, USER3);
    const resp = await page.request.get('/zone/1');
    expect(resp.status()).toBe(200);
  });

  test('admin can remove a user from a group', async ({ page }) => {
    await logIn(page, ADMIN);
    await adminPost(page, '/xhr/groups/assign', { groupLogin: 'group_1a', add: ['user3'] });

    const removeResp = await adminPost(page, '/xhr/groups/assign', { groupLogin: 'group_1a', remove: ['user3'] });
    expect(removeResp.status()).toBe(200);

    const result = await querySql(
      "SELECT COUNT(*)::int AS cnt FROM groups WHERE login = 'user3' AND \"group\" = 'group_1a'",
      [],
    );
    expect(result.rows[0].cnt).toBe(0);
  });

  test('removing group membership revokes zone access', async ({ page }) => {
    await querySql("DELETE FROM groups WHERE login = 'user2' AND \"group\" = 'group_1a'", []);

    await logIn(page, USER2);
    const resp = await page.request.get('/zone/1');
    expect(resp.status()).toBe(403);
  });

  test('non-admin cannot list group members (403)', async ({ page }) => {
    await logIn(page, USER1);
    const resp = await adminPost(page, '/xhr/groups/members', { ...TAB, groupLogin: 'group_1a' });
    expect(resp.status()).toBe(403);
  });

  test('non-admin cannot modify group membership (403)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await adminPost(page, '/xhr/groups/assign', { groupLogin: 'group_1a', add: ['user3'] });
    expect(resp.status()).toBe(403);
  });

});
