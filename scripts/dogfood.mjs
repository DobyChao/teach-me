import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { defaults } from '../src/shared/protocol.ts';
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/dogfood');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'endpoint.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    ...defaults,
    attachScreenshot: false,
    showInScreenCapture: true,
    autoCollapseSec: 8,
  }),
);
await fs.writeFile(
  path.join(home, 'panel-position.json'),
  JSON.stringify({ version: 1, displayId: -1, right: 1100, bottom: 750 }),
);
const env = { ...process.env, TEACH_ME_AGENT_HOME: home, TMA_LAUNCH_SECRET: 'dogfood-test' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require('electron'),
  ['test/desktop/dogfood.cjs', ...(process.argv.includes('--verify') ? ['--verify'] : [])],
  {
    env,
    stdio: 'inherit',
    windowsHide: true,
  },
);
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
