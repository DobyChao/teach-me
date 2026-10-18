import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { defaults } from '../src/shared/protocol.ts';
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/mini-panel');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'panel-position.json'), { force: true });
await fs.rm(path.join(home, 'mini-result.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    ...defaults,
    attachScreenshot: false,
    showInScreenCapture: true,
    autoCollapseSec: 0,
  }),
);
async function launch(resume) {
  await fs.rm(path.join(home, 'endpoint.json'), { force: true });
  const env = {
    ...process.env,
    TEACH_ME_AGENT_HOME: home,
    TMA_LAUNCH_SECRET: 'mini-panel-test',
    TMA_MINI_RESUME: resume ? '1' : '',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['test/desktop/mini-panel.cjs'], {
    env,
    stdio: 'inherit',
    windowsHide: true,
  });
  const timer = setTimeout(() => child.kill(), process.env.TMA_MINI_INTERACTIVE ? 600000 : 60000);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(timer);
      code === 0 ? resolve() : reject(new Error(`mini panel exit ${code}`));
    });
  });
}
try {
  await launch(false);
  await launch(true);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
