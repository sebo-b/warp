import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

async function openUser1(page: any) {
  await page.locator('#usersTable .tabulator-row', { hasText: 'user1' }).first()
    .locator('.tabulator-cell').first().click();
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(700);
}
const chips = (page: any) => page.evaluate(() =>
  [...document.querySelectorAll('#add_to_group .chip')].map((c: any) => c.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  await openUser1(page);
  console.log('open#1 chips=' + JSON.stringify(await chips(page)));
  // delete via the X button (real click)
  await page.locator('#add_to_group .chip .close').first().click();
  await page.waitForTimeout(200);
  console.log('after X  chips=' + JSON.stringify(await chips(page)));
  // Save
  await page.locator('#edit_modal_save_btn').click();
  await page.waitForTimeout(800);
  // Reopen and verify persisted removal
  await openUser1(page);
  console.log('reopen   chips=' + JSON.stringify(await chips(page)));

  // restore the group so the sample DB is left as found (re-add + save)
  await page.evaluate(() => {
    const el = document.getElementById('add_to_group');
    const inst = (window as any).M.Chips.getInstance(el);
    inst.addChip({ id: 'Group 1B [group_1b]', text: 'Group 1B [group_1b]' });
  });
  await page.waitForTimeout(150);
  await page.locator('#edit_modal_save_btn').click();
  await page.waitForTimeout(600);
  await browser.close();
})();
