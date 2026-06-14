import { readFileSync, writeFileSync, existsSync, rmSync } from 'fs';
import path from 'path';

/**
 * Connection details for the warp instance under test, chosen at global-setup
 * time. Because the container is published with `-P`, the host ports are random
 * and not known until the container is running — so global-setup writes them
 * here and every worker process reads them back (workers do not re-run global
 * setup, and env vars set in setup don't reliably reach them).
 */
export interface RuntimeInfo {
  baseURL: string;
  dbHost: string;
  dbPort: number;
  engine?: string;
  containerName?: string;
  startedBySetup: boolean;
}

const RUNTIME_FILE = path.resolve(__dirname, '..', '.e2e-runtime.json');

export function writeRuntimeInfo(info: RuntimeInfo): void {
  writeFileSync(RUNTIME_FILE, JSON.stringify(info, null, 2));
}

export function clearRuntimeInfo(): void {
  rmSync(RUNTIME_FILE, { force: true });
}

let cached: RuntimeInfo | null = null;

export function getRuntimeInfo(): RuntimeInfo {
  if (cached) return cached;

  // An explicit external target (a remote host, or a container you started by
  // hand for fast iteration) bypasses the runtime file and the managed
  // container entirely.
  if (process.env.E2E_BASE_URL) {
    cached = {
      baseURL: process.env.E2E_BASE_URL,
      dbHost: process.env.E2E_DB_HOST ?? '127.0.0.1',
      dbPort: Number(process.env.E2E_DB_PORT ?? 5432),
      startedBySetup: false,
    };
    return cached;
  }

  if (!existsSync(RUNTIME_FILE)) {
    throw new Error(
      `e2e runtime info not found at ${RUNTIME_FILE}. Run the tests through ` +
      `Playwright so global setup can start the container, or set E2E_BASE_URL ` +
      `to target an external instance.`);
  }

  cached = JSON.parse(readFileSync(RUNTIME_FILE, 'utf8')) as RuntimeInfo;
  return cached;
}
