import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1, USER2, USER3 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import { futureDayTs, getZoneSeats, apiApply } from '../../helpers/booking';

test.describe('non-admin forbidden from zone admin actions', () => {

  test('regular user cannot disable a seat (code 102)', async ({ page }) => {
    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const resp = await apiApply(page, { disable: [seat.id] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

  test('regular user cannot enable a seat (code 102)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    await querySql('UPDATE seat SET enabled = false WHERE id = $1', [seat.id]);

    await logIn(page, USER2);
    const resp = await apiApply(page, { enable: [seat.id] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

  test('regular user cannot assign a seat (code 102)', async ({ page }) => {
    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const resp = await apiApply(page, {
      assign: { sid: seat.id, logins: [{ login: 'user2', days_in_advance: null }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

  test('regular user cannot book for another login (code 102)', async ({ page }) => {
    await logIn(page, USER2);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, login: 'user1', dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

  test('regular user cannot delete another user booking (code 102)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user1', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );
    const bookResult = await querySql('SELECT id FROM book WHERE login = $1 AND sid = $2', ['user1', seat.id]);
    const bid = Number(bookResult.rows[0].id);

    await logIn(page, USER2);
    const resp = await apiApply(page, { remove: [bid] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

  test('non-zone-admin account cannot get zone users list (code 120)', async ({ page }) => {
    await logIn(page, USER2);
    const resp = await page.request.get('/xhr/plan/getUsers/1');
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(120);
  });

  test('user with no zone access cannot get zone users list', async ({ page }) => {
    await logIn(page, USER3);
    const resp = await page.request.get('/xhr/plan/getUsers/1');
    expect(resp.status()).toBe(403);
  });

  test('zone admin in Zone 1 cannot perform admin actions in Zone 2 (no access)', async ({ page }) => {
    await logIn(page, USER1);
    const zone2Seats = await getZoneSeats(2);
    const resp = await apiApply(page, { disable: [zone2Seats[0].id] });
    expect(resp.status()).toBe(403);
    expect((await resp.json()).code).toBe(102);
  });

});
