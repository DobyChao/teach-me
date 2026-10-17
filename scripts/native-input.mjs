import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const home = path.resolve('.runtime/native-input');
await fs.mkdir(home, { recursive: true });
await fs.rm(path.join(home, 'native-result.json'), { force: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    attachScreenshot: true,
    captureTier: 'ask',
    continueText: '下一步呢？',
    showInScreenCapture: true,
    autoCollapseSec: 0,
  }),
);
const env = {
  ...process.env,
  TEACH_ME_AGENT_HOME: home,
  TMA_LAUNCH_SECRET: 'native-input-fixture',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), ['test/desktop/native-input.cjs'], {
  env,
  windowsHide: true,
  stdio: 'inherit',
});
child.on('exit', (code) => {
  process.exitCode = code || 0;
});
