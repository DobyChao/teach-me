// Interactive Windows IME evidence; never substitutes Unicode injection for composition.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';
const home = path.resolve('.runtime/ime-observe');
await fs.mkdir(home, { recursive: true });
await fs.writeFile(
  path.join(home, 'panel-position.json'),
  JSON.stringify({ version: 1, displayId: -1, right: 600, bottom: 450 }),
);
await fs.writeFile(
  path.join(home, 'settings.json'),
  JSON.stringify({
    ...defaults,
    attachScreenshot: false,
    showInScreenCapture: true,
    autoCollapseSec: 0,
  }),
);
const env = { ...process.env, TEACH_ME_AGENT_HOME: home, TMA_LAUNCH_SECRET: 'ime-fixture' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)('electron'), ['test/desktop/ime-observe.cjs'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', (v) => {
  output += v;
  process.stdout.write(v);
});
child.stderr.on('data', (v) => (output += v));
const code = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error('IME observation timed out; unfinished is not a pass'));
  }, 1200000);
  child.once('error', (e) => {
    clearTimeout(timeout);
    reject(e);
  });
  child.once('exit', (value) => {
    clearTimeout(timeout);
    resolve(value);
  });
});
assert.equal(code, 0, output);
assert.match(output, /CHECKS_COMPLETE/);
