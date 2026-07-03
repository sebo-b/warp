import { test, expect } from '../fixtures';

// The manifest and service worker are fetched by the browser's install
// machinery with no session cookie, so they must be reachable even while
// logged out. Unit coverage in tests/test_pwa.py exercises the route logic
// in detail; this just proves the real deployed app serves them end to end.

test.describe('PWA install assets', () => {

  test('manifest is served without auth', async ({ request }) => {
    const resp = await request.get('/manifest.webmanifest');
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('application/manifest+json');

    const manifest = await resp.json();
    expect(manifest.name).toBe('WARP');
    expect(manifest.display).toBe('standalone');
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test('service worker is served without auth', async ({ request }) => {
    const resp = await request.get('/sw.js');
    expect(resp.status()).toBe(200);
    expect(resp.headers()['content-type']).toContain('javascript');
  });

  // res/gen_pwa_assets.sh statically greps that theme.css's --warp-primary,
  // base.html's <meta theme-color>, and view.py's manifest colors all match
  // one BG constant — but that check only runs when someone regenerates the
  // icons by hand, and it can't see the runtime-resolved CSS value (e.g. a
  // dark-theme override). This is the same guarantee, exercised end to end
  // against the actually-served app instead of grepped source.
  test('manifest and theme-color meta match the active --warp-primary token', async ({ page, request }) => {
    const manifest = await (await request.get('/manifest.webmanifest')).json();

    await page.goto('/login');
    const metaThemeColor = await page.locator('meta[name="theme-color"]').getAttribute('content');

    // getComputedStyle resolves --warp-primary to "rgb(r, g, b)", so normalize
    // the manifest/meta hex values the same way (via a throwaway element)
    // before comparing.
    const [primary, themeColor, backgroundColor, metaColor] = await page.evaluate(
      ([hexTheme, hexBg, hexMeta]) => {
        const toRgb = (hex: string) => {
          const el = document.createElement('div');
          el.style.color = hex;
          document.body.appendChild(el);
          const rgb = getComputedStyle(el).color;
          el.remove();
          return rgb;
        };
        return [
          getComputedStyle(document.documentElement).getPropertyValue('--warp-primary').trim(),
          toRgb(hexTheme),
          toRgb(hexBg),
          toRgb(hexMeta),
        ];
      },
      [manifest.theme_color, manifest.background_color, metaThemeColor],
    );

    expect(themeColor).toBe(primary);
    expect(backgroundColor).toBe(primary);
    expect(metaColor).toBe(primary);
  });

});
