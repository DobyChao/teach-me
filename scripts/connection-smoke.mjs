import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';
const home = path.resolve('.runtime/connection', String(Date.now()));
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
await fs.writeFile(
  path.join(home, 'panel-position.json'),
  JSON.stringify({ version: 1, displayId: -1, right: 1000, bottom: 800 }),
);
const env = { ...process.env, TEACH_ME_AGENT_HOME: home, TMA_LAUNCH_SECRET: 'connection-fixture' };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(
  createRequire(import.meta.url)('electron'),
  ['test/desktop/connection.cjs', ...process.argv.slice(2)],
  { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
);
let output = '';
child.stdout.on('data', (value) => {
  output += value;
  process.stdout.write(value);
});
child.stderr.on('data', (value) => (output += value));
const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(
    () => {
      child.kill();
      reject(new Error(`connection fixture timed out\n${output}`));
    },
    process.argv.includes('--interactive') ? 120000 : 45000,
  );
  child.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once('exit', (value) => {
    clearTimeout(timer);
    resolve(value);
  });
});
assert.equal(code, 0, output);
assert.match(output, /CHECKS_COMPLETE/);
await assert.rejects(fs.access(path.join(home, 'endpoint.json')));
