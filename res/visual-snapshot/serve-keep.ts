// Boot ONE sandbox container and leave it running (keep=true), so live
// debugging/inspection can reuse it via VISUAL_BASE_URL without rebuilding.
// Run: cd e2e && NODE_PATH="$(pwd)/node_modules" npx tsx ../res/visual-snapshot/serve-keep.ts
import { startSandbox, exposeToHelpers } from './container';
import { resetDb } from '../../e2e/helpers/db';
import { freezeClock } from './capture';

async function main() {
  const sandbox = await startSandbox(true); // keep alive after exit
  exposeToHelpers(sandbox);
  await resetDb();
  await freezeClock(sandbox.baseURL);
  console.log('READY');
  console.log('VISUAL_BASE_URL=' + sandbox.baseURL);
  console.log('container=' + (sandbox.containerName ?? '?'));
}
main().catch((e) => { console.error(e); process.exit(1); });
