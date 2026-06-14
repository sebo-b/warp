import { execFileSync } from 'child_process';
import path from 'path';
import { writeRuntimeInfo, RuntimeInfo } from './helpers/runtime';

export const IMAGE_TAG = 'warp-e2e';

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

function run(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: 'inherit', cwd: REPO_ROOT });
}

function capture(cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8' });
}

async function serverIsUp(baseURL: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseURL}/login`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForServer(baseURL: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await serverIsUp(baseURL)) return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`warp did not become ready at ${baseURL}/login within ${timeoutMs}ms`);
}

// The host port the engine assigned to a container port via `-P`. Output of
// `<engine> port <name> 5000/tcp` looks like "0.0.0.0:49153\n[::]:49153".
function mappedHostPort(engine: string, name: string, containerPort: number): number {
  const out = capture(engine, ['port', name, `${containerPort}/tcp`]);
  for (const line of out.split('\n')) {
    const m = line.trim().match(/:(\d+)$/);
    if (m) return Number(m[1]);
  }
  throw new Error(`could not determine host port for ${containerPort} on '${name}':\n${out}`);
}

export default async function globalSetup() {
  // External / manually managed target: never touch containers, just point the
  // suite at it. Useful for fast iteration or testing a remote deployment.
  if (process.env.E2E_BASE_URL) {
    console.log(`Using external warp at ${process.env.E2E_BASE_URL}`);
    await waitForServer(process.env.E2E_BASE_URL, 30_000);
    writeRuntimeInfo({
      baseURL: process.env.E2E_BASE_URL,
      dbHost: process.env.E2E_DB_HOST ?? '127.0.0.1',
      dbPort: Number(process.env.E2E_DB_PORT ?? 5432),
      startedBySetup: false,
    });
    return;
  }

  const engine = detectContainerEngine();

  // Always rebuild (layer cache makes this fast when nothing changed) and run a
  // *fresh* container, so the suite can never reuse a stale instance.
  console.log(`Building image '${IMAGE_TAG}' from Dockerfile_debug...`);
  run(engine, ['build', '-f', 'containers/Dockerfile_debug', '-t', IMAGE_TAG, '.']);

  // Unique name so concurrent runs (other terminals, CI shards) and unrelated
  // local containers never collide.
  const containerName = `warp-e2e-${process.pid}-${Date.now()}`;

  console.log(`Starting container '${containerName}' on random ports...`);
  run(engine, [
    'run', '-d',
    '--name', containerName,
    // -P publishes every EXPOSEd port (5000, 5432) to a random free host port,
    // so the suite never fights with whatever else is bound to 5000/5432.
    '-P',
    // The suite resets the database directly over TCP, so Postgres must bind
    // all interfaces inside the container (off by default — see Dockerfile_debug).
    '-e', 'EXPOSE_POSTGRES=1',
    IMAGE_TAG,
  ]);

  const appPort = mappedHostPort(engine, containerName, 5000);
  const dbPort = mappedHostPort(engine, containerName, 5432);
  const baseURL = `http://127.0.0.1:${appPort}`;

  const info: RuntimeInfo = {
    baseURL,
    dbHost: '127.0.0.1',
    dbPort,
    engine,
    containerName,
    startedBySetup: true,
  };
  writeRuntimeInfo(info);

  console.log(`warp: ${baseURL}   postgres: 127.0.0.1:${dbPort}`);
  // First start initializes the database (schema + sample data), allow time.
  await waitForServer(baseURL, 120_000);
  console.log('warp is up.');
}
