import { execFileSync } from 'child_process';
import { getRuntimeInfo, clearRuntimeInfo } from './helpers/runtime';

export default async function globalTeardown() {
  let info;
  try {
    info = getRuntimeInfo();
  } catch {
    return; // nothing was set up
  }

  try {
    // Only remove the container if global-setup started it; an external or
    // manually started instance (E2E_BASE_URL) is left running.
    if (info.startedBySetup && info.containerName && info.engine) {
      console.log(`Removing container '${info.containerName}'...`);
      execFileSync(info.engine, ['rm', '-f', info.containerName], { stdio: 'inherit' });
    }
  } finally {
    clearRuntimeInfo();
  }
}
