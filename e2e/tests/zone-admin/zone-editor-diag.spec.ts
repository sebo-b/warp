import { test, expect } from '../../fixtures';
import { logIn } from '../../helpers/auth';
import { ADMIN } from '../../helpers/users';

test('diagnostic: inspect element at (500,400) in add mode after preceding test', async ({ page }) => {
  await logIn(page, ADMIN);
  await page.goto('/zones/modify/1?return=/zones');
  await expect(page.locator('#zone_map')).toBeVisible();
  await page.waitForLoadState('networkidle');

  // toggle to add mode
  const lever = page.locator('label:has(#modeSwitch) .lever');
  await lever.click();
  await expect(page.locator('#modeSwitch')).toBeChecked();

  // inspect DOM at click position
  const info = await page.evaluate(() => {
    const container = document.getElementById('zone_map_container')!;
    const containerRect = container.getBoundingClientRect();
    const img = document.getElementById('zone_map')!;
    const imgRect = img.getBoundingClientRect();

    // elements at img position + (500, 400)
    const absX = imgRect.left + 500;
    const absY = imgRect.top + 400;
    const els = document.elementsFromPoint(absX, absY);

    return {
      containerRect: { left: containerRect.left, top: containerRect.top, width: containerRect.width, height: containerRect.height },
      imgRect: { left: imgRect.left, top: imgRect.top, width: imgRect.width, height: imgRect.height },
      absX, absY,
      elementsFromPoint: els.map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        style: (el as HTMLElement).getAttribute('style') || '',
        outerHTML: el.outerHTML.slice(0, 200),
      })),
      containerChildren: Array.from(container.children).map(el => ({
        tag: el.tagName,
        id: el.id,
        className: el.className,
        style: (el as HTMLElement).getAttribute('style') || '',
        outerHTML: el.outerHTML.slice(0, 200),
      })),
    };
  });

  console.log('=== DIAGNOSTIC ===');
  console.log(JSON.stringify(info, null, 2));

  // Force fail so we always see the output
  expect(info.elementsFromPoint[0].tag).toBe('IMG');
});
