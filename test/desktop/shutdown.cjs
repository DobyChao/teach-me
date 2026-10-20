const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
globalShortcut.register = () => true;
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const scenario = process.env.TMA_SHUTDOWN_SCENARIO;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  let endpoint;
  for (let n = 0; n < 150; n++) {
    try {
      const candidate = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      if (candidate.pid === process.pid) {
        endpoint = candidate;
        break;
      }
    } catch {}
    await pause(100);
  }
  assert.ok(endpoint);
  let token = '';
  const call = async (route, data = {}) => {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': endpoint.token,
        'x-session-token': token,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(scenario === 'interactive' && route === 'wait' ? 300000 : 10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  token = (
    await call('start', {
      launchSecret: 'shutdown-fixture',
      displayId: (await call('status')).displayId,
      topic: '退出恢复验收',
    })
  ).token;
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  await call('say', { text: '退出恢复验收：关闭此窗口后应能重新启动。' });
  const waiting = call('wait', { timeoutMs: scenario === 'interactive' ? 300000 : 60000 });
  // Attach a handler immediately so a watchdog exit never produces an unhandled rejection.
  waiting.catch(() => {});
  await pause(300);
  if (scenario === 'restore-error') {
    panel.getNativeWindowHandle = () => {
      throw new Error('PRIVATE_FIXTURE window restore unavailable');
    };
  }
  let endpointCleanupStarted = false;
  if (scenario === 'endpoint-error' || scenario === 'endpoint-hang') {
    const rm = fs.rm;
    fs.rm = async (file, ...args) => {
      if (file === path.join(home, 'endpoint.json')) {
        endpointCleanupStarted = true;
        if (scenario === 'endpoint-hang') return new Promise(() => {});
        throw Object.assign(new Error('PRIVATE_FIXTURE endpoint locked'), { code: 'EACCES' });
      }
      return rm(file, ...args);
    };
  }
  console.log(`READY: ${scenario}`);
  if (scenario === 'interactive') {
    assert.equal((await waiting).ended, true);
    console.log('CHECKS_COMPLETE');
    return;
  }
  if (scenario === 'native-close') panel.close();
  else if (scenario === 'app-quit') app.quit();
  else {
    const stops = Promise.all([call('stop'), call('stop')]);
    stops.catch(() => {});
    if (scenario === 'endpoint-hang') {
      for (let n = 0; n < 100 && !endpointCleanupStarted; n++) await pause(10);
      assert.ok(endpointCleanupStarted, 'wait for shutdown to reach injected operation');
      await assert.rejects(call('say', { text: 'must reject while shutting down' }), /退出/);
      await assert.rejects(call('start'), /退出/);
      for (const action of [
        { type: 'edit', on: true },
        { type: 'settings-focus', on: true },
      ]) {
        await assert.rejects(
          panel.webContents.executeJavaScript(
            `window.companion.perform(${JSON.stringify(action)})`,
          ),
          /退出/,
        );
      }
      app.quit();
      panel.close();
      assert.equal((await waiting).ended, true);
      console.log('CHECKS_COMPLETE');
      return;
    }
    await stops;
  }
  assert.equal((await waiting).ended, true, 'pending wait is settled before process exit');
  console.log('CHECKS_COMPLETE');
}
run().catch((e) => {
  console.error(e);
  app.exit(2);
});
