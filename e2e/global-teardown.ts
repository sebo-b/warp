import { execFileSync } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { CONTAINER_NAME, MARKER_FILE } from './global-setup';

const CONTAINER_ENGINE = process.env.E2E_CONTAINER_ENGINE ?? 'podman';

export default async function globalTeardown() {
  // Only stop the container if global-setup started it; a manually started
  // or external instance is left running.
  if (!existsSync(MARKER_FILE)) return;

  console.log(`Removing container '${CONTAINER_NAME}'...`);
  try {
    execFileSync(CONTAINER_ENGINE, ['rm', '-f', CONTAINER_NAME], { stdio: 'inherit' });
  } finally {
    rmSync(MARKER_FILE, { force: true });
  }
}
