import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { USER1 } from '../../helpers/users';
import { querySql } from '../../helpers/db';
import {
  futureDayTs,
  getZoneSeats,
  clickZoneSeat,
  waitForSeatsLoaded,
  apiApply,
} from '../../helpers/booking';
import { pickFirstDate } from '../../helpers/zone-admin';

test.describe('booking as another user', () => {

  test('zone admin can book a seat for another user via API', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    const resp = await apiApply(page, {
      book: { sid: seat.id, login: 'user2', dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });
    expect(resp.status()).toBe(200);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user2', seat.id],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

  test('zone admin booking for another user does NOT create a booking for themselves', async ({ page }) => {
    await logIn(page, USER1);
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await apiApply(page, {
      book: { sid: seat.id, login: 'user2', dates: [{ fromTS: ts + 9 * 3600, toTS: ts + 17 * 3600 }] },
    });

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user1', seat.id],
    );
    expect(result.rows[0].cnt).toBe(0);
  });

  test('zone admin can book a seat via "Book as" UI (autocomplete)', async ({ page }) => {
    await logIn(page, USER1);
    await page.goto('/plan/1');
    await waitForSeatsLoaded(page);

    await pickFirstDate(page);
    await page.waitForTimeout(400);

    const bookAsInput = page.locator('#book-as');
    await bookAsInput.click();
    await bookAsInput.pressSequentially('Bar', { delay: 50 });
    const dropdownItem = page.locator('ul.autocomplete-content li', { hasText: 'Bar [user2]' });
    await expect(dropdownItem).toBeVisible({ timeout: 5000 });
    await dropdownItem.click();
    await page.waitForTimeout(200);

    const [seat] = await getZoneSeats(1);
    await clickZoneSeat(page, seat);
    await expect(page.locator('#action_modal')).toHaveClass(/open/);
    await Promise.all([
      page.waitForResponse(r => r.url().includes('/xhr/zone/apply') && r.status() === 200),
      page.locator('.zone_action_btn[data-action="book"]').click(),
    ]);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(200);

    const result = await querySql(
      'SELECT COUNT(*)::int AS cnt FROM book WHERE login = $1 AND sid = $2',
      ['user2', seat.id],
    );
    expect(result.rows[0].cnt).toBe(1);
  });

  test('zone admin can delete another user booking via API (remove)', async ({ page }) => {
    const [seat] = await getZoneSeats(1);
    const ts = futureDayTs(1);
    await querySql(
      'INSERT INTO book (login, sid, fromts, tots) VALUES ($1, $2, $3, $4)',
      ['user2', seat.id, ts + 9 * 3600, ts + 17 * 3600],
    );

    const bookResult = await querySql('SELECT id FROM book WHERE login = $1 AND sid = $2', ['user2', seat.id]);
    const bid = Number(bookResult.rows[0].id);

    await logIn(page, USER1);
    const resp = await apiApply(page, { remove: [bid] });
    expect(resp.status()).toBe(200);

    const countResult = await querySql('SELECT COUNT(*)::int AS cnt FROM book WHERE id = $1', [bid]);
    expect(countResult.rows[0].cnt).toBe(0);
  });

});
