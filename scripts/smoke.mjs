import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs/promises';
import { build } from 'esbuild';
await build({
  entryPoints: ['test/desktop/html-smoke.ts'],
  outfile: 'dist/test/html-smoke.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
});
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/electron-smoke');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'endpoint.json'), { force: true });
await fs.rm(path.join(home, 'result.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    attachScreenshot: false,
    captureTier: 'ask',
    autoCollapseSec: 0,
    continueText: '下一步呢？',
  }),
);
const env = {
  ...process.env,
  TEACH_ME_AGENT_HOME: home,
  TMA_LAUNCH_SECRET: 'isolated-smoke-handshake',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['test/desktop/smoke.cjs'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => {
  child.kill();
  console.error('Electron smoke timed out');
}, 45000);
child.on('error', (e) => {
  clearTimeout(timer);
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', async (code, signal) => {
  clearTimeout(timer);
  let passed = false;
  try {
    passed = JSON.parse(await fs.readFile(path.join(home, 'result.json'), 'utf8')).passed;
  } catch {}
  if (code !== 0 || !passed)
    console.error(
      `Electron smoke failed: exit=${code}, signal=${signal || 'none'}, result=${passed ? 'passed' : 'missing/failed'}`,
    );
  process.exitCode = code === 0 && passed ? 0 : 1;
});
