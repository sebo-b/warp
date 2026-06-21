// Inline sandbox lifecycle for the visual-snapshot tool.
//
// This is a deliberate, self-contained copy of the ~40 lines of proven
// container handling from e2e/global-setup.ts. For a rare throwaway tool the
// abstraction tax of coupling to global-setup (and constraining the e2e
// suite's freedom to refactor) costs more than the copy. Removed wholesale
// when this directory is deleted. See PLAN_visual_regression_screenshots.md.

import { execFileSync } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const IMAGE_TAG = 'warp-visual-snapshot';

export interface Sandbox {
  baseURL: string;
  dbHost: string;
  dbPort: number;
  engine: string;
  containerName?: string;
  stop(): Promise<void>;
}

function detectEngine(): string {
  if (process.env.E2E_CONTAINER_ENGINE) return process.env.E2E_CONTAINER_ENGINE;
  try {
    execFileSync('podman', ['--version'], { stdio: 'ignore' });
    return 'podman';
  } catch {
    return 'docker';
  }
}

function run(cmd: string, args: string[]): void {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
}

function capture(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

// `<engine> port <name> 5000/tcp` → "0.0.0.0:49153\n[::]:49153"; take the last :N.
function mappedHostPort(engine: string, name: string, containerPort: number): number {
  const out = capture(engine, ['port', name, `${containerPort}/tcp`]);
  for (const line of out.split('\n')) {
    const m = line.trim().match(/:(\d+)$/);
    if (m) return Number(m[1]);
  }
  throw new Error(`could not determine host port for ${containerPort} on '${name}':\n${out}`);
}

async function waitForServer(baseURL: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return;
    } catch {
      /* keep polling */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`warp did not become ready at ${baseURL}/login within ${timeoutMs}ms`);
}

/**
 * Start (or attach to) the sandbox. When `keep` is true the container is left
 * running on stop() so a subsequent run can reuse the image cache.
 *
 * Escape hatch: set `VISUAL_BASE_URL` to point at an already-running instance
 * (mirrors the e2e `E2E_BASE_URL` convention) — no build/run, no-op stop().
 */
export async function startSandbox(keep: boolean): Promise<Sandbox> {
  if (process.env.VISUAL_BASE_URL) {
    const baseURL = process.env.VISUAL_BASE_URL;
    console.log(`Using external warp at ${baseURL}`);
    await waitForServer(baseURL, 30_000);
    return {
      baseURL,
      dbHost: process.env.E2E_DB_HOST ?? '127.0.0.1',
      dbPort: Number(process.env.E2E_DB_PORT ?? 5432),
      engine: 'external',
      stop: async () => {},
    };
  }

  const engine = detectEngine();

  // Always rebuild (layer cache makes this fast) + fresh container, so the
  // tool can never reuse a stale instance.
  console.log(`Building image '${IMAGE_TAG}' from Dockerfile_debug...`);
  run(engine, ['build', '-f', 'containers/Dockerfile_debug', '-t', IMAGE_TAG, '.']);

  const containerName = `warp-visual-${process.pid}-${Date.now()}`;
  console.log(`Starting container '${containerName}' on random ports...`);
  run(engine, [
    'run', '-d',
    '--name', containerName,
    '-P',                              // publish 5000/5432 to random host ports
    '-e', 'EXPOSE_POSTGRES=1',         // resetDb connects over TCP
    IMAGE_TAG,
  ]);

  const appPort = mappedHostPort(engine, containerName, 5000);
  const dbPort = mappedHostPort(engine, containerName, 5432);
  const baseURL = `http://127.0.0.1:${appPort}`;
  console.log(`warp: ${baseURL}   postgres: 127.0.0.1:${dbPort}`);
  // First start initializes the DB (schema + sample data); allow time.
  await waitForServer(baseURL, 120_000);
  console.log('warp is up.');

  return {
    baseURL,
    dbHost: '127.0.0.1',
    dbPort,
    engine,
    containerName,
    stop: async () => {
      if (keep) {
        console.log(`Keeping container '${containerName}' (--keep-container).`);
        return;
      }
      try {
        run(engine, ['rm', '-f', containerName]);
      } catch {
        /* best effort */
      }
    },
  };
}

/**
 * Expose the sandbox to the reused e2e leaf helpers. `db.ts` →
 * `getRuntimeInfo()` reads `E2E_BASE_URL`/`E2E_DB_HOST`/`E2E_DB_PORT` first, so
 * setting these env vars (before the first call to resetDb/querySql) makes
 * the imported helpers target this sandbox with zero refactor.
 */
export function exposeToHelpers(s: Sandbox): void {
  process.env.E2E_BASE_URL = s.baseURL;
  process.env.E2E_DB_HOST = s.dbHost;
  process.env.E2E_DB_PORT = String(s.dbPort);
}