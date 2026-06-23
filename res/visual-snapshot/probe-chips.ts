import { chromium } from '@playwright/test';
import { logIn } from '../../e2e/helpers/auth';
import { ADMIN } from '../../e2e/helpers/users';

const BASE = process.env.VISUAL_BASE_URL!;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: BASE });
  const page = await ctx.newPage();
  await logIn(page, ADMIN);
  await page.goto('/users', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  // Instrument BEFORE the modal/chips init happens
  await page.evaluate(() => {
    const w = window as any;
    w.__log = [];
    const M = w.M;
    const proto = M.Chips.prototype;
    let ids = 0;
    const realInit = M.Chips.init.bind(M.Chips);
    M.Chips.init = function (el: any, opts: any) {
      const inst = realInit(el, opts);
      if (inst && !inst.__cid) inst.__cid = 'init#' + (++ids);
      w.__log.push('M.Chips.init -> ' + (inst && inst.__cid));
      return inst;
    };
    const realCtorTag = proto.constructor;
    const od = proto.deleteChip;
    proto.deleteChip = function (i: number) {
      w.__log.push('deleteChip(' + i + ') cid=' + (this.__cid || 'AUTO') + ' dataLen=' + this.chipsData.length);
      return od.call(this, i);
    };
    const orem = Element.prototype.remove;
    Element.prototype.remove = function () {
      if ((this as any).classList && (this as any).classList.contains('chip'))
        w.__log.push('chip.remove() direct');
      return orem.call(this);
    };
    const odes = proto.destroy;
    proto.destroy = function () { w.__log.push('destroy cid=' + (this.__cid || 'AUTO')); return odes.call(this); };
  });

  await page.locator('#usersTable .tabulator-row', { hasText: 'user1' }).first()
    .locator('.tabulator-cell').first().click();
  await page.locator('#edit_modal').waitFor({ state: 'visible' });
  await page.waitForTimeout(800);

  const snap = (lbl: string) => page.evaluate((l) => {
    const el = document.getElementById('add_to_group');
    const inst = (window as any).M.Chips.getInstance(el);
    return l + ' currentInst=' + (inst && inst.__cid) + ' chipsData=' + JSON.stringify(inst ? inst.getData().map((d: any) => d.id) : null);
  }, lbl);

  console.log(await snap('INITIAL'));
  await page.locator('#add_to_group .chip .close').first().click();
  await page.waitForTimeout(300);
  console.log(await snap('AFTER DELETE'));
  // re-add the same group via the instance API (mirrors selecting it in autocomplete)
  await page.evaluate(() => {
    const el = document.getElementById('add_to_group');
    const inst = (window as any).M.Chips.getInstance(el);
    inst.addChip({ id: 'Group 1B [group_1b]', text: 'Group 1B [group_1b]' });
  });
  await page.waitForTimeout(200);
  console.log(await snap('AFTER RE-ADD'));
  console.log('visibleChips=' + JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#add_to_group .chip')].map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))));
  console.log('LOG=' + JSON.stringify(await page.evaluate(() => (window as any).__log), null, 0));

  await browser.close();
})();
