import { execFileSync } from 'child_process';
import { writeFileSync, rmSync } from 'fs';
import path from 'path';
import { BASE_URL } from './playwright.config';

export const CONTAINER_NAME = 'warp-e2e';
export const IMAGE_TAG = 'warp-e2e';
export const MARKER_FILE = path.join(__dirname, '.container-started-by-setup');

const REPO_ROOT = path.resolve(__dirname, '..');

function detectContainerEngine(): string {
  if (process.env.E2E_CONTAINER_ENGINE) return process.env.E2E_CONTAINER_ENGINE;
  try {
    execFileSync('podman', ['--version'], { stdio: 'ignore' });
    return 'podman';
  } catch {
    return 'docker';
  }
}

export const CONTAINER_ENGINE = detectContainerEngine();

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
}

async function serverIsUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE_URL}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverIsUp()) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`warp did not become ready at ${BASE_URL}/login within ${timeoutMs}ms`);
}

export default async function globalSetup() {
  rmSync(MARKER_FILE, { force: true });

  // Reuse an already-running instance (e.g. a container started manually,
  // or a remote target selected via E2E_BASE_URL).
  if (await serverIsUp()) {
    console.log(`Reusing already-running warp at ${BASE_URL}`);
    return;
  }

  console.log(`Building image '${IMAGE_TAG}' from Dockerfile_debug...`);
  run(CONTAINER_ENGINE, ['build', '-f', 'containers/Dockerfile_debug', '-t', IMAGE_TAG, '.']);

  // Remove a stale (stopped) container from a previous aborted run.
  try {
    execFileSync(CONTAINER_ENGINE, ['rm', '-f', CONTAINER_NAME], { stdio: 'ignore' });
  } catch {
    /* no stale container */
  }

  console.log(`Starting container '${CONTAINER_NAME}'...`);
  run(CONTAINER_ENGINE, [
    'run', '-d',
    '--name', CONTAINER_NAME,
    '-p', '5000:5000',
    '-p', '5432:5432',
    // The suite resets the database directly over TCP, so Postgres must bind
    // all interfaces inside the container (off by default — see Dockerfile_debug).
    '-e', 'EXPOSE_POSTGRES=1',
    IMAGE_TAG,
  ]);
  writeFileSync(MARKER_FILE, CONTAINER_NAME);

  // First start initializes the database (schema + sample data), allow time.
  await waitForServer(120_000);
  console.log('warp is up.');
}
