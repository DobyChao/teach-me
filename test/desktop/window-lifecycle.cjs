// Interactive fixture: activate Paint, Ctrl+Alt+W/Escape twice, then send the
// fixed test text. Only synthetic capture is used; no Paint canvas is read.
const { app, BrowserWindow, desktopCapturer, nativeImage, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (v) => fs.writeFile(path.join(home, 'lifecycle-result.json'), JSON.stringify(v));
function cli(...args) {
  return new Promise((resolve, reject) => {
    const c = spawn(process.execPath, ['bin/teach-me.mjs', ...args, '--client', 'lifecycle'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '',
      err = '';
    c.stdout.on('data', (v) => (out += v));
    c.stderr.on('data', (v) => (err += v));
    c.on('error', reject);
    c.on('exit', (code) => {
      if (code) reject(new Error(err));
      else {
        try {
          resolve(JSON.parse(out));
        } catch (e) {
          reject(e);
        }
      }
    });
  });
}
async function run() {
  await app.whenReady();
  let endpoint;
  for (let i = 0; i < 150; i++) {
    try {
      endpoint = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      break;
    } catch {
      await pause(100);
    }
  }
  assert.ok(endpoint);
  const r = await fetch(`http://127.0.0.1:${endpoint.port}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-companion-token': endpoint.token },
    body: JSON.stringify({
      topic: 'Paint 前台切换验证',
      displayId: screen.getPrimaryDisplay().id,
      launchSecret: process.env.TMA_LAUNCH_SECRET,
    }),
  });
  const driver = await r.json();
  assert.ok(r.ok);
  await fs.mkdir(path.join(home, 'clients'), { recursive: true });
  await fs.writeFile(
    path.join(home, 'clients', createHash('sha256').update('lifecycle').digest('hex') + '.json'),
    JSON.stringify(driver),
  );
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const overlay = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=overlay'),
  );
  const native = new (require('../../dist/test/window-policy-smoke.cjs').WindowStyleProbe)();
  const identity = () =>
    [panel, overlay].map((w) => ({
      id: w.id,
      handle: w.getNativeWindowHandle().toString('hex'),
      pid: w.webContents.getOSProcessId(),
    }));
  const initial = identity();
  const handles = [panel, overlay].map((w) =>
    w.getNativeWindowHandle().readBigUInt64LE().toString(),
  );
  const counts = {
    show: 0,
    hide: 0,
    minimize: 0,
    restore: 0,
    created: 0,
    activation: 0,
    taskbar: 0,
  };
  for (const event of ['show', 'hide', 'minimize', 'restore'])
    panel.on(event, () => counts[event]++);
  app.on('browser-window-created', () => counts.created++);
  for (const w of [panel, overlay]) {
    const focus = w.setFocusable.bind(w);
    w.setFocusable = (v) => {
      counts.activation++;
      return focus(v);
    };
    const taskbar = w.setSkipTaskbar.bind(w);
    w.setSkipTaskbar = (v) => {
      counts.taskbar++;
      return taskbar(v);
    };
  }
  let captures = 0,
    captureBeforeFocus = true;
  desktopCapturer.getSources = async () => {
    captures++;
    const fg = await native.foreground();
    captureBeforeFocus &&= !handles.includes(fg) && !panel.isFocused();
    return [
      {
        display_id: String(screen.getPrimaryDisplay().id),
        thumbnail: nativeImage.createFromBitmap(Buffer.alloc(64, 255), { width: 4, height: 4 }),
      },
    ];
  };
  async function check(styles = true) {
    assert.equal(panel.isVisible(), true);
    assert.equal(panel.isMinimized(), false);
    assert.deepEqual(identity(), initial);
    if (styles) await native.check(panel, overlay);
    for (const value of Object.values(counts)) assert.equal(value, 0, JSON.stringify(counts));
  }
  async function until(phase) {
    for (let i = 0; i < 4800; i++) {
      const s = await panel.webContents.executeJavaScript('window.companion.snapshot()');
      if (s.input.phase === phase) return;
      await check(false);
      await pause(100);
    }
    throw new Error('等待输入阶段超时');
  }
  await report({ stage: 'ready', counts });
  const waiting = cli('wait', '--timeout', '480');
  for (let round = 1; round <= 3; round++) {
    await until('editing');
    await pause(150);
    await check();
    assert.equal(panel.isFocused(), true, 'the native panel must actually receive keyboard focus');
    assert.equal(
      await panel.webContents.executeJavaScript(
        'document.activeElement===document.querySelector("textarea")',
      ),
      true,
      'the real textarea must own keyboard input',
    );
    assert.ok(captureBeforeFocus, 'each frame must precede activation');
    await report({ stage: 'editing', round, counts, captures, captureBeforeFocus });
    await until('idle');
    await pause(150);
    await check();
    await report({ stage: 'idle', round, counts, captures, captureBeforeFocus });
  }
  const message = await waiting;
  assert.equal(message.messages[0].text, '窗口前台切换测试');
  await cli('say', '窗口前台切换测试已收到。');
  await pause(200);
  await check();
  await report({ stage: 'passed', counts, captures, captureBeforeFocus });
  native.dispose();
}
run().catch(async (e) => {
  await report({ stage: 'failed', error: e.message });
  console.error(e.stack);
});
