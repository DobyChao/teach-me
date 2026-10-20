// Real Electron crash/recovery checks, isolated from normal profiles and shortcuts.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';

const require = createRequire(import.meta.url);
const baseline = process.argv.includes('--baseline');
const interactive = process.argv.includes('--interactive');
const failureModes = ['repeat', 'load-failed', 'load-hang'];
assert.ok(!(baseline && interactive), 'choose baseline or interactive');
const home = path.resolve('.runtime/renderer-recovery', String(Date.now()));
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
  JSON.stringify({ version: 1, displayId: -1, right: 600, bottom: 450 }),
);
async function run(mode) {
  const env = {
    ...process.env,
    TEACH_ME_AGENT_HOME: home,
    TMA_LAUNCH_SECRET: 'renderer-recovery-fixture',
    TMA_RENDERER_RECOVERY_MODE: mode,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), ['test/desktop/renderer-recovery.cjs'], {
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let injectedAt = 0;
  child.stdout.on('data', (value) => {
    output += value;
    if (String(value).includes('injected load-hang')) injectedAt = Date.now();
    process.stdout.write(value);
  });
  child.stderr.on('data', (value) => (output += value));
  const code = await new Promise((resolve, reject) => {
    const watchdog = setTimeout(
      () => {
        child.kill();
        reject(new Error(`renderer recovery ${mode} timed out\n${output}`));
      },
      mode === 'interactive' ? 330000 : 45000,
    );
    child.once('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.once('exit', (value) => {
      clearTimeout(watchdog);
      resolve(value);
    });
  });
  assert.equal(code, failureModes.includes(mode) ? 1 : 0, output);
  assert.match(output, /CHECKS_COMPLETE/);
  if (mode === 'load-hang') {
    assert.ok(injectedAt, 'hang injection must actually run');
    assert.ok(Date.now() - injectedAt >= 9000, 'must exercise the real recovery timeout');
    assert.ok(Date.now() - injectedAt < 16000, 'recovery and shutdown must both be bounded');
  }
  await assert.rejects(fs.access(path.join(home, 'endpoint.json')));
  if (failureModes.includes(mode)) {
    const log = await fs.readFile(path.join(home, 'runtime.log'), 'utf8');
    const event =
      mode === 'repeat'
        ? 'panel-recovery-exhausted'
        : mode === 'load-hang'
          ? 'panel-recovery-timeout'
          : 'panel-recovery-failed';
    assert.ok(log.includes(`"event":"${event}"`), `${mode} records its actual terminal path`);
  }
}

await run(baseline ? 'baseline' : interactive ? 'interactive' : 'recovery');
await run('restart');
if (!baseline && !interactive) {
  for (const mode of failureModes) {
    await run(mode);
    await run('restart');
  }
}
console.log(
  baseline
    ? 'PASS: reproduced unavailable panel with live host/API and single-instance lock; same profile restarts'
    : 'PASS: same-window renderer recovery retains queued messages and accepts new input; same profile restarts',
);
