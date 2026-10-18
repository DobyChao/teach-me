import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { defaults } from '../src/shared/protocol.ts';
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/panel-modes');
await fs.mkdir(home, { recursive: true });
for (const name of ['endpoint.json', 'panel-position.json', 'result.json'])
  await fs.rm(path.join(home, name), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    ...defaults,
    attachScreenshot: false,
    showInScreenCapture: true,
    autoCollapseSec: 1,
  }),
);
const env = { ...process.env, TEACH_ME_AGENT_HOME: home, TMA_LAUNCH_SECRET: 'panel-modes-test' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['test/desktop/panel-modes.cjs'], {
  env,
  stdio: 'inherit',
  windowsHide: true,
});
const timer = setTimeout(() => child.kill(), env.TMA_PANEL_INTERACTIVE ? 600000 : 90000);
child.on('error', (e) => {
  console.error(e.message);
  process.exitCode = 1;
});
child.on('exit', (code) => {
  clearTimeout(timer);
  process.exitCode = code ?? 1;
});
