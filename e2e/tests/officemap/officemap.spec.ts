import { test, expect } from '@playwright/test';

// Phase 1 isolated e2e for the OfficeMap component (PLAN_officemap.md §10).
// No backend — serves the static test page (index.html) + the real OfficeMap
// module + sprite + sample map via serve.mjs. Run:
//   npx playwright test --config=e2e/playwright.officemap.config.ts

const PAGE = '/index.html';

async function settle(page) {
  // Let panzoom's rAF-deferred transform + clamp settle so seat rects are stable.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

async function ready(page) {
  await page.goto(PAGE);
  await page.waitForFunction(() => window.__om && window.__om._pz, null, { timeout: 8000 });
  await settle(page);
}

test.describe('OfficeMap — rendering & model', () => {

  test('renders a seat element per seat with id=sprite-{id} and the right href', async ({ page }) => {
    await ready(page);
    const n = await page.evaluate(() => window.__seed().length);
    const count = await page.locator('.OMSeat').count();
    expect(count).toBe(n);

    // First seat is 's0' with sprite 'available' → href ends with #cell-available.
    const href = await page.locator('#sprite-s0 use').getAttribute('href');
    expect(href).toContain('#cell-available');

    // Valid seat (s0, 'available') has NO fallback node — zero waste for the
    // common case. Its glyph's only child is the <use>.
    const s0children = await page.locator('#sprite-s0 .OMSeatGlyph').evaluate(svg =>
      Array.from(svg.children).map(c => c.tagName));
    expect(s0children).toEqual(['use']);

    // Unknown sprite name ('bogus') renders with #cell-bogus and, once the
    // sprite's cells are loaded, shows a red fallback disc behind the <use>.
    await page.waitForFunction(() => window.__om._validCells !== null, null, { timeout: 5000 });
    const bogus = await page.evaluate(() => {
      const seat = [...document.querySelectorAll('.OMSeat use')]
        .find(u => u.getAttribute('href').endsWith('#cell-bogus'))
        .closest('.OMSeat');
      const svg = seat.querySelector('.OMSeatGlyph');
      const fb = svg.querySelector('circle');
      return fb ? { r: fb.getAttribute('r'), first: svg.firstElementChild.tagName }
                : null;
    });
    expect(bogus).not.toBeNull();
    expect(bogus.r).toBe('10.5');
    expect(bogus.first.toLowerCase()).toBe('circle');
  });

  test('seat position matches data x,y', async ({ page }) => {
    await ready(page);
    const seat0 = await page.locator('#sprite-s0');
    await expect(seat0).toBeVisible();
    const left = await seat0.evaluate(el => parseFloat(el.style.left));
    const top  = await seat0.evaluate(el => parseFloat(el.style.top));
    const data = await page.evaluate(() => window.__seed()[0]);
    expect(left).toBeCloseTo(data.x, 0);
    expect(top).toBeCloseTo(data.y, 0);
  });

  test('label shown only when labelTitle or labelBody non-null', async ({ page }) => {
    await ready(page);
    // s0 is labelled (i%3===0), s1 is not.
    const s0display = await page.locator('#sprite-s0 .OMLabel').evaluate(el => getComputedStyle(el).display);
    const s1display = await page.locator('#sprite-s1 .OMLabel').evaluate(el => getComputedStyle(el).display);
    expect(s0display).not.toBe('none');
    expect(s1display).toBe('none');
  });

  test('clear and reseed recreate the seat set', async ({ page }) => {
    await ready(page);
    await page.click('#clear');
    await expect(page.locator('.OMSeat')).toHaveCount(0);
    await page.click('#reseed');
    const n = await page.evaluate(() => window.__seed().length);
    await expect(page.locator('.OMSeat')).toHaveCount(n);
  });

  test('updateSeat(id, null) deletes; updateSeat(newid, data) creates', async ({ page }) => {
    await ready(page);
    const before = await page.locator('.OMSeat').count();
    await page.evaluate(() => window.__om.updateSeat('s0', null));
    await expect(page.locator('#sprite-s0')).toHaveCount(0);
    await page.evaluate(() => window.__om.updateSeat('zz9', { id:'zz9', x:100, y:100, sprite:'yours', labelTitle:'Z', labelBody:null, hintTitle:null, hintBody:null }));
    await expect(page.locator('#sprite-zz9')).toBeVisible();
    const after = await page.locator('.OMSeat').count();
    expect(after).toBe(before); // one deleted, one added
  });
});

test.describe('OfficeMap — zoom & pan', () => {

  test('initial zoom is fit: whole image visible inside the viewport', async ({ page }) => {
    await ready(page);
    // At fit the whole office is visible: image rect sits within the viewport
    // rect (letterbox gaps allowed, but never cropped and never off-screen).
    const inside = await page.evaluate(() => {
      const bg = window.__bgRect(), root = window.__rootRect();
      return bg.left >= root.left - 0.5 && bg.right <= root.right + 0.5 &&
             bg.top >= root.top - 0.5 && bg.bottom <= root.bottom + 0.5;
    });
    expect(inside).toBeTruthy();
    const scale = await page.evaluate(() => window.__scale());
    expect(scale).toBeGreaterThan(0);
  });

  test('zoom-in button increases scale; reset returns to fit', async ({ page }) => {
    await ready(page);
    const s0 = await page.evaluate(() => window.__scale());
    await page.click('.OMZoom-in');
    await page.waitForFunction((base) => window.__scale() > base + 1e-3, s0);
    const s1 = await page.evaluate(() => window.__scale());
    expect(s1).toBeGreaterThan(s0 + 1e-3);
    await page.click('.OMZoom-reset');
    await page.waitForFunction((base) => Math.abs(window.__scale() - base) < 0.02, s0);
    const s2 = await page.evaluate(() => window.__scale());
    expect(Math.abs(s2 - s0)).toBeLessThan(0.02);
  });

  test('wheel zoom changes scale', async ({ page }) => {
    await ready(page);
    const s0 = await page.evaluate(() => window.__scale());
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.mouse.wheel(0, -300); // negative deltaY → zoom in
    await page.waitForFunction((base) => window.__scale() > base + 0.01, s0);
    const s1 = await page.evaluate(() => window.__scale());
    expect(s1).toBeGreaterThan(s0 + 0.01);
  });

  test('drag-pan moves the world and stays within bounds (image covers viewport)', async ({ page }) => {
    await ready(page);
    // Zoom in a bit first so there is room to pan.
    await page.click('.OMZoom-in');
    await page.click('.OMZoom-in');
    await page.waitForTimeout(200);
    const box = await page.locator('#map').boundingBox();
    const cx = box.x + box.width/2, cy = box.y + box.height/2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 200, cy + 200, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);
    const covers = await page.evaluate(() => {
      const bg = window.__bgRect(), root = window.__rootRect();
      return bg.left <= root.left + 1 && bg.right >= root.right - 1 &&
             bg.top <= root.top + 1 && bg.bottom >= root.bottom - 1;
    });
    expect(covers).toBeTruthy();
  });

  test('bounds: cannot zoom out below fit', async ({ page }) => {
    await ready(page);
    const fit = await page.evaluate(() => window.__scale());
    const box = await page.locator('#map').boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    for (let i = 0; i < 8; i++) await page.mouse.wheel(0, 400); // zoom out hard
    await page.waitForTimeout(300);
    const s = await page.evaluate(() => window.__scale());
    expect(s).toBeGreaterThanOrEqual(fit - 1e-6);
  });
});

test.describe('OfficeMap — counter-scale (S1 follow vs S2 flat)', () => {

  test('follow mode: sprite screen size scales with the map (s=k, cs=1)', async ({ page }) => {
    await ready(page);
    await page.click('#mode-follow');
    // Glyph svg width is 48 in world units; under follow at scale k the on-screen
    // width is 48*k. Measure seat glyph width before/after a zoom-in.
    const w0 = (await page.evaluate(() => window.__seatRect('s0')))?.width;
    const s0 = await page.evaluate(() => window.__scale());
    await page.click('.OMZoom-in');
    await page.waitForFunction((base) => window.__scale() > base + 1e-3, s0);
    await page.waitForTimeout(280);  // button zoom animates (200ms transition)
    const w1 = (await page.evaluate(() => window.__seatRect('s0')))?.width;
    const s1 = await page.evaluate(() => window.__scale());
    // Glyph grew roughly proportionally with k (follow: width ≈ 48*k).
    expect(w1 / w0).toBeCloseTo(s1 / s0, 1);
  });

  test('flat mode: sprite screen size stays ~constant under zoom (s=1, cs=1/k)', async ({ page }) => {
    await ready(page);
    await page.click('#mode-flat');
    const w0 = (await page.evaluate(() => window.__seatRect('s0')))?.width;
    await page.click('.OMZoom-in');
    await page.click('.OMZoom-in');
    await page.waitForTimeout(280);  // button zoom animates (200ms transition)
    const w1 = (await page.evaluate(() => window.__seatRect('s0')))?.width;
    // Stays ~48px (the cell size) regardless of zoom.
    expect(Math.abs(w1 - w0)).toBeLessThan(6);
  });
});

test.describe('OfficeMap — interaction', () => {

  test('click emits { id } and does not fire after a drag', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => window.__resetClicks());
    const box = await page.locator('#sprite-s2').boundingBox();
    await page.mouse.click(box.x + box.width/2, box.y + box.height/2);
    await page.waitForTimeout(100);
    const clicked = await page.evaluate(() => window.__lastClick);
    expect(clicked).toBe('s2');
    expect(await page.evaluate(() => window.__clickCount)).toBe(1);

    // A drag should NOT produce a click (browser suppresses click after drag,
    // and pointerup with movement returns early).
    await page.evaluate(() => window.__resetClicks());
    const s5 = await page.locator('#sprite-s5').boundingBox();
    const cx = s5.x + s5.width/2, cy = s5.y + s5.height/2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 120, cy + 120, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__clickCount)).toBe(0);
  });

  test('desktop hover shows the hint popup; leaving hides it', async ({ page }) => {
    await ready(page);
    await page.evaluate(() => { // force fine-pointer behaviour path
      window.__coarse = false;
    });
    const box = await page.locator('#sprite-s0').boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.waitForTimeout(100);
    const visible = await page.locator('.OMHint').evaluate(el => el.classList.contains('OMHint--visible'));
    expect(visible).toBeTruthy();
    await page.mouse.move(10, 10);
    await page.waitForTimeout(100);
    const stillVisible = await page.locator('.OMHint').evaluate(el => el.classList.contains('OMHint--visible'));
    expect(stillVisible).toBeFalsy();
  });

  test('a seat with null hintTitle AND null hintBody shows no hint on hover', async ({ page }) => {
    await ready(page);
    // Inject a seat with no hint content.
    await page.evaluate(() => window.__om.updateSeat('nohint', { id:'nohint', x:50, y:50, sprite:'available', labelTitle:'NH', labelBody:null, hintTitle:null, hintBody:null }));
    const box = await page.locator('#sprite-nohint').boundingBox();
    await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
    await page.waitForTimeout(120);
    const visible = await page.locator('.OMHint').evaluate(el => el.classList.contains('OMHint--visible'));
    expect(visible).toBeFalsy();
  });

  test('long-press (touch) shows hint without emitting a click', async ({ page, browserName }) => {
    await ready(page);
    // Emulate a touch long-press via the Touch API on a coarse context.
    const cdp = await page.context().newCDPSession(page);
    const box = await page.locator('#sprite-s3').boundingBox();
    const cx = Math.round(box.x + box.width/2), cy = Math.round(box.y + box.height/2);
    await page.evaluate(() => window.__resetClicks());
    // touchStart
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ state: 'touchPressed', x: cx, y: cy, id: 0, radiusX: 1, radiusY: 1 }],
    });
    // Hold beyond LONG_PRESS_MS (500ms) — wait 600ms.
    await page.waitForTimeout(650);
    const hintVisible = await page.locator('.OMHint').evaluate(el => el.classList.contains('OMHint--visible'));
    expect(hintVisible).toBeTruthy();
    // Release.
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ state: 'touchReleased', x: cx, y: cy, id: 0, radiusX: 1, radiusY: 1 }],
    });
    await page.waitForTimeout(150);
    // Long-press should NOT have emitted a click.
    expect(await page.evaluate(() => window.__clickCount)).toBe(0);
  });

  test('quick tap (touch) emits a click without showing a hint', async ({ page }) => {
    await ready(page);
    const cdp = await page.context().newCDPSession(page);
    const box = await page.locator('#sprite-s4').boundingBox();
    const cx = Math.round(box.x + box.width/2), cy = Math.round(box.y + box.height/2);
    await page.evaluate(() => window.__resetClicks());
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ state: 'touchPressed', x: cx, y: cy, id: 0, radiusX: 1, radiusY: 1 }],
    });
    await page.waitForTimeout(80); // quick — under the 500ms long-press threshold
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [{ state: 'touchReleased', x: cx, y: cy, id: 0, radiusX: 1, radiusY: 1 }],
    });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__clickCount)).toBe(1);
    expect(await page.evaluate(() => window.__lastClick)).toBe('s4');
    const hintVisible = await page.locator('.OMHint').evaluate(el => el.classList.contains('OMHint--visible'));
    expect(hintVisible).toBeFalsy();
  });

  test('pinch (two-finger) zoom changes scale', async ({ page }) => {
    await ready(page);
    const s0 = await page.evaluate(() => window.__scale());
    const cdp = await page.context().newCDPSession(page);
    const box = await page.locator('#map').boundingBox();
    const cx = Math.round(box.x + box.width/2), cy = Math.round(box.y + box.height/2);
    // Two touches starting 20px apart, moving to 160px apart (pinch out → zoom in).
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { state: 'touchPressed', x: cx - 10, y: cy, id: 0, radiusX: 1, radiusY: 1 },
        { state: 'touchPressed', x: cx + 10, y: cy, id: 1, radiusX: 1, radiusY: 1 },
      ],
    });
    for (const d of [30, 60, 90, 120, 160]) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          { state: 'touchMoved', x: cx - d, y: cy, id: 0, radiusX: 1, radiusY: 1 },
          { state: 'touchMoved', x: cx + d, y: cy, id: 1, radiusX: 1, radiusY: 1 },
        ],
      });
      await page.waitForTimeout(40);
    }
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [
        { state: 'touchReleased', x: cx - 160, y: cy, id: 0, radiusX: 1, radiusY: 1 },
        { state: 'touchReleased', x: cx + 160, y: cy, id: 1, radiusX: 1, radiusY: 1 },
      ],
    });
    await page.waitForTimeout(300);
    const s1 = await page.evaluate(() => window.__scale());
    expect(s1).toBeGreaterThan(s0 + 0.01);
  });
});

test.describe('OfficeMap — dark mode filter', () => {
  test('filter option is applied to OMBackground', async ({ page }) => {
    await ready(page);
    // The page constructs OfficeMap with filter:null, so none applied. Rebuild
    // with a filter and assert it lands on the <img>.
    await page.evaluate(() => {
      const m = document.getElementById('map');
      m.__om && m.__om.destroy && m.__om.destroy();
      m.replaceChildren();
      const { OfficeMap } = window;
      // re-import already happened; reuse class via globalThis
    });
    // Re-create through evaluate with a filter string.
    const got = await page.evaluate(async () => {
      const mod = await import('/js/views/modules/officeMap.js');
      const m = document.getElementById('map');
      m.replaceChildren();
      const om = new mod.OfficeMap(m, {
        mapImage: '/maps/zone1b.png',
        sprite: { url: '/static/images/seat_icons.svg', cellWidth: 48, cellHeight: 48 },
        zoom: { initial: 'fit' },
        filter: 'invert(1) hue-rotate(180deg)',
      });
      await new Promise(r => om.bg.addEventListener('load', r, { once: true }));
      return getComputedStyle(om.bg).filter;
    });
    expect(got).toContain('invert');
  });
});