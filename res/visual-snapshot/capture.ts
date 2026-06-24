// Per-screen capture: resolve path → navigate → prepare? → settle → screenshot.
// Continue-on-error per screen (recorded in the manifest) so one broken screen
// never aborts the whole run.

import { type BrowserContext, type Page } from '@playwright/test';
import { logIn, expectLoggedIn } from '../../e2e/helpers/auth';
import { ADMIN, USER1 } from '../../e2e/helpers/users';
import { type Screen, type ResolveCtx, SCREENS } from './screens';

export interface ScreenResult {
  id: string;
  title: string;
  role: string;
  file?: string;
  ok: boolean;
  error?: string;
}

// Kill transitions/animations + hide the caret so two runs of unchanged code
// are pixel-identical. Injected once per page after navigation.
const DE_ANIMATE_CSS = `
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
  .caret { display: none !important; }
`;

async function settle(page: Page): Promise<void> {
  // Wait for network to quiet (XHR tables, web fonts) before shooting.
  await page.waitForLoadState('networkidle');
  // Give web fonts a chance, then one frame so layout settles.
  try { await page.evaluate(() => (document as any).fonts?.ready); } catch { /* no fonts API */ }
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r(null))));
}

async function ensureLoggedIn(ctx: BrowserContext, role: 'admin' | 'user'): Promise<void> {
  // Add a marker on the context so we only log in once per role.
  const page = ctx.pages()[0] ?? await ctx.newPage();
  if (await page.evaluate((r) => (window as any).__warp_logged_in__ === r, role)) return;
  const user = role === 'admin' ? ADMIN : USER1;
  await logIn(page, user);
  await expectLoggedIn(page);
  await page.evaluate((r) => { (window as any).__warp_logged_in__ = r; }, role);
}

export interface CaptureDeps {
  adminCtx: BrowserContext;
  userCtx: BrowserContext;
  anonCtx: BrowserContext;
  resolveCtx: ResolveCtx;
  outDir: string;
  only?: Set<string>;
}

export async function captureAll(deps: CaptureDeps): Promise<ScreenResult[]> {
  const results: ScreenResult[] = [];
  for (const screen of SCREENS) {
    if (deps.only && !deps.only.has(screen.id)) continue;
    const result = await captureOne(screen, deps).catch((err: unknown) => ({
      id: screen.id,
      title: screen.title,
      role: screen.role,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }));
    results.push(result);
    console.log(`  ${result.ok ? 'ok  ' : 'FAIL'} ${screen.id}${result.error ? ' — ' + result.error : ''}`);
  }
  return results;
}

async function captureOne(screen: Screen, deps: CaptureDeps): Promise<ScreenResult> {
  const ctx = screen.role === 'anon' ? deps.anonCtx
    : screen.role === 'admin' ? deps.adminCtx
    : deps.userCtx;

  if (screen.role !== 'anon') {
    await ensureLoggedIn(ctx, screen.role);
  }

  const page = await ctx.newPage();
  try {
    if (screen.viewport) {
      await page.setViewportSize({ width: screen.viewport.width, height: screen.viewport.height });
    }
    const target = typeof screen.path === 'function'
      ? await Promise.resolve(screen.path(deps.resolveCtx))
      : screen.path;
    await page.goto(target, { waitUntil: 'load' });
    await page.addStyleTag({ content: DE_ANIMATE_CSS });
    if (screen.prepare) await screen.prepare(page);
    await settle(page);

    const fullPage = screen.fullPage ?? true;
    const file = `${screen.id}.png`;
    await page.screenshot({ path: `${deps.outDir}/${file}`, fullPage });
    return { id: screen.id, title: screen.title, role: screen.role, file, ok: true };
  } finally {
    await page.close();
  }
}

/** Freeze the server clock to a fixed instant (before login, so sessions don't expire). */
export async function freezeClock(baseURL: string): Promise<void> {
  // TARGET: 2026-01-15 12:00:00 UTC. Offset = target - realNow (seconds).
  const TARGET = Date.UTC(2026, 0, 15, 12, 0, 0) / 1000;
  const offset = Math.floor(TARGET - Date.now() / 1000);
  const resp = await fetch(`${baseURL}/debug/set_time_offset`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ offset_seconds: offset }),
  });
  if (!resp.ok) throw new Error(`freezeClock failed: HTTP ${resp.status}`);
}