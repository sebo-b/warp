// Entry point: orchestration (thin). Boots the sandbox, resets the DB, freezes
// the clock, captures every screen in the catalogue into a timestamped run
// directory, writes the manifest, regenerates the matrix report.
//
// Run with:  cd e2e && npm run snapshot -- --label before
// Args: --label <name>  --only <id,id>  --keep-container  --prune <N>

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext } from '@playwright/test';

import { startSandbox, exposeToHelpers, type Sandbox } from './container';
import { SCREENS, CATALOGUE_ORDER, type ResolveCtx } from './screens';
import { captureAll, freezeClock, type ScreenResult } from './capture';
import { generateReport, REPORT_PATH } from './report';
import { resetDb, querySql } from '../../e2e/helpers/db';

const ROOT = path.resolve(__dirname, '..');
const OUT_ROOT = path.join(ROOT, 'visual-snapshots');
const RUNS_DIR = path.join(OUT_ROOT, 'runs');

// --- args -------------------------------------------------------------------

interface Args { label?: string; only?: Set<string>; keepContainer: boolean; prune?: number; }

function parseArgs(): Args {
  const a: Args = { keepContainer: false };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--label') a.label = argv[++i];
    else if (arg === '--only') a.only = new Set((argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean));
    else if (arg === '--keep-container') a.keepContainer = true;
    else if (arg === '--prune') a.prune = Number(argv[++i]);
    else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run snapshot -- [--label NAME] [--only id,id] [--keep-container] [--prune N] [--help]');
      process.exit(0);
    }
  }
  return a;
}

function gitSha(): string {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); }
  catch { return 'unknown'; }
}

// --- main ------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs();

  const sandbox = await startSandbox(args.keepContainer);
  // Expose sandbox to the imported e2e leaf helpers (db.ts reads these env vars).
  exposeToHelpers(sandbox);

  // 1. Deterministic DB: pristine sample data.
  await resetDb();
  console.log('DB reset to sample data.');

  // 2. Freeze the server clock (before login so sessions don't expire).
  await freezeClock(sandbox.baseURL);
  console.log('Server clock frozen.');

  const resolveCtx: ResolveCtx = { sql: (text) => querySql(text) };

  // 3. One browser, three contexts (anon / admin / user), login once per role.
  const browser = await chromium.launch();
  const baseViewport = { width: 1280, height: 900, deviceScaleFactor: 1 };
  const newCtx = (): BrowserContext => browser.newContext({
    viewport: baseViewport, deviceScaleFactor: 1, baseURL: sandbox.baseURL,
  });
  const anonCtx = await newCtx();
  const adminCtx = await newCtx();
  const userCtx = await newCtx();

  // 4. Run directory + manifest.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const runId = args.label ? `${ts}_${args.label}` : ts;
  const outDir = path.join(RUNS_DIR, runId);
  mkdirSync(outDir, { recursive: true });

  console.log(`Capturing ${args.only ? args.only.size : SCREENS.length} screen(s) → runs/${runId}/`);
  const screens: ScreenResult[] = await captureAll({
    adminCtx, userCtx, anonCtx, resolveCtx, outDir, only: args.only,
  });

  const manifest = {
    runId,
    label: args.label,
    gitSha: gitSha(),
    startedAt: ts,
    engine: sandbox.engine,
    screens,
  };
  writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  await anonCtx.close(); await adminCtx.close(); await userCtx.close();
  await browser.close();

  // 5. Prune old runs if asked.
  if (args.prune !== undefined) pruneRuns(args.prune);

  // 6. Regenerate the matrix report.
  writeFileSync(REPORT_PATH, generateReport(CATALOGUE_ORDER));
  const ok = screens.filter((s) => s.ok).length;
  console.log(`\nDone: ${ok}/${screens.length} screens captured.`);
  console.log(`Report: ${REPORT_PATH}`);

  await sandbox.stop();
}

function pruneRuns(keepN: number): void {
  if (!statSync(RUNS_DIR).isDirectory()) return;
  const dirs = readdirSync(RUNS_DIR)
    .map((n) => ({ n, p: path.join(RUNS_DIR, n) }))
    .filter((d) => statSync(d.p).isDirectory())
    // oldest first (ISO lexicographic); keep the newest `keepN`.
    .sort((a, b) => (a.n < b.n ? -1 : 1));
  const toRemove = dirs.slice(0, Math.max(0, dirs.length - keepN));
  for (const d of toRemove) {
    rmSync(d.p, { recursive: true, force: true });
    console.log(`Pruned old run ${d.n}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});