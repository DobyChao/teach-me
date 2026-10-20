// Isolated real-Electron exit/restart checks. No user profile or global shortcuts.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { defaults } from '../src/shared/protocol.ts';

const require = createRequire(import.meta.url);
const modes = process.argv.includes('--interactive')
  ? ['interactive']
  : ['normal', 'restore-error', 'endpoint-error', 'endpoint-hang', 'native-close', 'app-quit'];
const root = path.resolve('.runtime', `shutdown-${Date.now()}`);
for (const mode of modes) {
  const home = path.join(root, mode);
  await fs.mkdir(home, { recursive: true });
  await fs.writeFile(
    path.join(home, 'settings.json'),
    JSON.stringify({ ...defaults, attachScreenshot: false, showInScreenCapture: true }),
  );
  async function run(scenario) {
    const env = {
      ...process.env,
      TEACH_ME_AGENT_HOME: home,
      TMA_LAUNCH_SECRET: 'shutdown-fixture',
      TMA_SHUTDOWN_SCENARIO: scenario,
    };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(require('electron'), ['test/desktop/shutdown.cjs'], {
      env,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (v) => {
      output += v;
      if (scenario === 'interactive') process.stdout.write(v);
    });
    child.stderr.on('data', (v) => (output += v));
    const code = await new Promise((resolve, reject) => {
      const watchdog = setTimeout(
        () => {
          child.kill();
          reject(new Error(`${scenario}: process did not exit\n${output}`));
        },
        scenario === 'interactive' ? 300000 : 25000,
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
    assert.equal(code, scenario === 'endpoint-hang' ? 1 : 0, output);
    assert.match(output, /READY/);
    assert.match(output, /CHECKS_COMPLETE/, 'exit alone does not prove shutdown assertions ran');
    return output;
  }
  await run(mode);
  const events = (await fs.readFile(path.join(home, 'runtime.log'), 'utf8'))
    .trim()
    .split('\n')
    .map(JSON.parse);
  if (mode === 'endpoint-hang') assert.ok(events.some((e) => e.event === 'shutdown-timeout'));
  else {
    assert.ok(events.some((e) => e.event === 'quit'));
    if (mode === 'endpoint-error')
      assert.ok(
        events.some(
          (e) =>
            e.event === 'shutdown-cleanup-failed' && e.step === 'endpoint' && e.code === 'EACCES',
        ),
      );
    else await assert.rejects(fs.access(path.join(home, 'endpoint.json')));
  }
  assert.ok(!JSON.stringify(events).includes('PRIVATE_FIXTURE'));
  await run('normal'); // Same profile, including an intentionally stale endpoint.
  console.log(`PASS: ${mode}; process exits and same profile restarts`);
}
