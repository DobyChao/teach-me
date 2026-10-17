import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import { defaults } from '../src/shared/protocol.ts';
import { build } from 'esbuild';
await build({
  entryPoints: ['test/desktop/window-policy-smoke.ts'],
  outfile: 'dist/test/window-policy-smoke.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/board-smoke');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'endpoint.json'), { force: true });
await fs.rm(path.join(home, 'board-result.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({ ...defaults, showInScreenCapture: true, attachScreenshot: false }),
);
const env = { ...process.env, TEACH_ME_AGENT_HOME: home, TMA_LAUNCH_SECRET: 'board-smoke' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['test/desktop/board-smoke.cjs'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => child.kill(), process.env.TMA_BOARD_INTERACTIVE ? 600000 : 90000);
child.on('error', (e) => {
  clearTimeout(timer);
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', async (code) => {
  clearTimeout(timer);
  let passed = false;
  try {
    passed = JSON.parse(await fs.readFile(path.join(home, 'board-result.json'), 'utf8')).passed;
  } catch {}
  process.exitCode = code === 0 && passed ? 0 : 1;
});
