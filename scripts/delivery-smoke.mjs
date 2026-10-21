import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';
const require = createRequire(import.meta.url);
const interactive = process.argv.includes('--interactive');
const home = path.resolve('.runtime', `delivery-${Date.now()}`);
await fs.mkdir(home, { recursive: true });
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    ...defaults,
    attachScreenshot: false,
    showInScreenCapture: true,
    autoCollapseSec: 0,
  }),
);
const env = {
  ...process.env,
  TEACH_ME_AGENT_HOME: home,
  TMA_LAUNCH_SECRET: 'delivery-fixture',
};
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  require('electron'),
  ['test/desktop/delivery.cjs', ...(interactive ? ['--interactive'] : [])],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
child.stdout.on('data', (v) => {
  output += v;
  process.stdout.write(v);
});
child.stderr.on('data', (v) => (output += v));
const code = await new Promise((resolve, reject) => {
  const watchdog = setTimeout(
    () => {
      child.kill();
      reject(new Error('delivery smoke timed out'));
    },
    interactive ? 330000 : 30000,
  );
  child.once('error', (e) => {
    clearTimeout(watchdog);
    reject(e);
  });
  child.once('exit', (value) => {
    clearTimeout(watchdog);
    resolve(value);
  });
});
assert.equal(code, 0, output);
assert.match(output, /CHECKS_COMPLETE/);
console.log('PASS: committed delivery survives focus failure; next message is delivered');
