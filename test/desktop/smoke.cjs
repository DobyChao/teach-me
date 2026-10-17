// Runs inside Electron against the real host, renderer and spawned CLI.
// Screen attachments use an injected synthetic frame, never the real desktop.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../../dist/host/main.cjs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const home = process.env.TEACH_ME_AGENT_HOME;
const checks = [];
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
function cli(...args) {
  const child = spawn(process.execPath, ['bin/teach-me.mjs', ...args, '--client', 'smoke-cli'], {
    windowsHide: true,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Promise((resolve, reject) => {
    let output = '',
      error = '';
    child.stdout.on('data', (s) => (output += s));
    child.stderr.on('data', (s) => (error += s));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code !== 0) return reject(new Error(`CLI exit ${code}: ${error}`));
      try {
        resolve(JSON.parse(output));
      } catch (e) {
        reject(e);
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
  assert.ok(endpoint, 'host endpoint published');
  let token = '';
  const call = async (route, data = {}) => {
    const res = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': endpoint.token,
        'x-session-token': token,
      },
      body: JSON.stringify(data),
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error);
    return result;
  };
  const driver = await call('start', {
    displayId: require('electron').screen.getPrimaryDisplay().id,
    topic: '自动集成测试',
    launchSecret: process.env.TMA_LAUNCH_SECRET,
  });
  token = driver.token;
  checks.push('CLI API start handshake');
  let panel;
  for (let i = 0; i < 100; i++) {
    panel = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('mode=panel'),
    );
    if (
      panel &&
      (await panel.webContents.executeJavaScript(
        '!!window.companion && !!document.querySelector("textarea")',
      ))
    )
      break;
    await pause(50);
  }
  assert.ok(panel);
  const js = (code) => panel.webContents.executeJavaScript(code);
  const perform = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  const initial = await js('window.companion.snapshot()');
  const overlay = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=overlay'),
  );
  const identities = [panel, overlay].map((w) => ({
    id: w.id,
    handle: w.getNativeWindowHandle().toString('hex'),
    renderer: w.webContents.getOSProcessId(),
  }));
  const policies = new Map([
    [panel.id, false],
    [overlay.id, true],
  ]);
  let activationMutations = 0,
    taskbarMutations = 0;
  for (const w of [panel, overlay]) {
    const setSkip = w.setSkipTaskbar.bind(w);
    w.setSkipTaskbar = (skip) => {
      taskbarMutations++;
      policies.set(w.id, skip);
      return setSkip(skip);
    };
    const setFocusable = w.setFocusable.bind(w);
    w.setFocusable = (accept) => {
      activationMutations++;
      return setFocusable(accept);
    };
  }
  let created = 0;
  const onCreated = () => created++;
  app.on('browser-window-created', onCreated);
  const styleProbe = new (require('../../dist/test/window-policy-smoke.cjs').WindowStyleProbe)();
  await styleProbe.check(panel, overlay);
  for (let i = 0; i < 3; i++) {
    const preparing = await perform({ type: 'prepare' });
    assert.equal(preparing.input.phase, 'editing');
    assert.equal(policies.get(panel.id), false, 'panel keeps taskbar entry when focused');
    await styleProbe.check(panel, overlay);
    await perform({ type: 'cancel' });
    assert.equal(policies.get(panel.id), false, 'panel keeps taskbar entry when released');
    await styleProbe.check(panel, overlay);
    await perform({ type: 'settings-focus', on: true });
    await perform({ type: 'settings-focus', on: false });
    assert.equal(policies.get(panel.id), false);
    await perform({ type: 'edit', on: true });
    assert.equal(policies.get(overlay.id), true, 'editable overlay never becomes taskbar entry');
    await styleProbe.check(panel, overlay);
    await perform({ type: 'edit', on: false });
    assert.equal(policies.get(overlay.id), true);
  }
  assert.equal(created, 0);
  assert.equal(activationMutations, 0, 'input must not toggle the Electron activation delegate');
  assert.equal(taskbarMutations, 0, 'input must not remove/readd taskbar tabs');
  assert.equal(panel.isMinimizable(), false);
  assert.deepEqual(
    [panel, overlay].map((w) => ({
      id: w.id,
      handle: w.getNativeWindowHandle().toString('hex'),
      renderer: w.webContents.getOSProcessId(),
    })),
    identities,
  );
  app.removeListener('browser-window-created', onCreated);
  styleProbe.dispose();
  checks.push(
    'repeated prepare/cancel/settings/board preserve HWNDs, renderer PIDs, window count and taskbar policies',
  );
  const chrome = BrowserWindow.getAllWindows().filter((w) =>
    w.webContents.getURL().includes('mode='),
  );
  assert.ok(chrome.every((w) => w.isContentProtected()));
  await perform({ type: 'settings', settings: { ...initial.settings, showInScreenCapture: true } });
  assert.ok(chrome.every((w) => !w.isContentProtected()));
  const saved = JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8'));
  assert.equal(saved.showInScreenCapture, true);
  await perform({
    type: 'settings',
    settings: { ...initial.settings, showInScreenCapture: false },
  });
  assert.ok(chrome.every((w) => w.isContentProtected()));
  checks.push('capture visibility toggles both native windows and persists');
  assert.equal(await js('typeof window.companion.send'), 'undefined');
  checks.push('restricted preload bridge');
  await call('say', { text: '这是宿主发来的测试指引。' });
  await pause(100);
  assert.match(await js('document.body.innerText'), /这是宿主发来的测试指引/);
  checks.push('host say renders in real React DOM');
  await js('window.__inputIdentity=document.querySelector("textarea");true');
  await perform({ type: 'toggle-expanded' });
  await pause(50);
  await perform({ type: 'toggle-expanded' });
  await pause(50);
  assert.equal(await js('window.__inputIdentity===document.querySelector("textarea")'), true);
  checks.push('composer DOM survives collapse/expand');
  const pending = call('wait', { timeoutMs: 5000 });
  await pause(50);
  const prepared = await perform({ type: 'prepare' });
  assert.equal(prepared.input.phase, 'editing');
  await pause(100);
  assert.equal(await js('document.activeElement===document.querySelector("textarea")'), true);
  checks.push('prepare focuses the single composer');
  await perform({
    type: 'submit',
    turnId: prepared.input.turnId,
    text: '发送测试',
    attachBoard: false,
  });
  const received = await pending;
  assert.equal(received.messages[0].text, '发送测试');
  assert.equal(received.messages[0].shots.length, 0);
  await call('ack', { id: received.messages[0].id });
  checks.push('real IPC submit -> session wait -> ack');
  await call('say', { text: '等待你的下一步。' });
  await pause(100);
  assert.equal(await js('!!document.querySelector(".offer")'), true);
  checks.push('ready state exposes continue chip');
  const quiet = await call('wait', { timeoutMs: 20 });
  assert.equal(quiet.timeout, true);
  checks.push('acked messages are not redelivered');
  const keyboardWait = call('wait', { timeoutMs: 5000 });
  await perform({ type: 'prepare' });
  await pause(100);
  await panel.webContents.insertText('键盘发送测试');
  await pause(100);
  assert.equal(await js('document.querySelector("textarea").value'), '键盘发送测试');
  await js('document.querySelector("textarea").setSelectionRange(1,3);true');
  await perform({ type: 'toggle-expanded' });
  await perform({ type: 'toggle-expanded' });
  await pause(80);
  assert.deepEqual(
    await js(
      '({value:document.querySelector("textarea").value,start:document.querySelector("textarea").selectionStart,end:document.querySelector("textarea").selectionEnd})',
    ),
    { value: '键盘发送测试', start: 1, end: 3 },
  );
  checks.push('draft and selection survive collapse/expand');
  panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
  panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  const keyboardMessage = await keyboardWait;
  assert.equal(keyboardMessage.messages[0].text, '键盘发送测试');
  await call('ack', { id: keyboardMessage.messages[0].id });
  await pause(100);
  assert.equal(await js('document.querySelector("textarea").value'), '');
  checks.push('real textarea input + Enter sends and clears only after delivery');
  await fs.mkdir(path.join(home, 'clients'), { recursive: true });
  await fs.writeFile(
    path.join(home, 'clients', createHash('sha256').update('smoke-cli').digest('hex') + '.json'),
    JSON.stringify(driver),
  );
  assert.equal((await cli('start')).id, driver.id);
  assert.equal((await cli('status')).session.id, driver.id);
  for (let round = 1; round <= 2; round++) {
    const receivedByCli = cli('wait', '--timeout', '480');
    for (let i = 0; i < 100; i++) {
      if ((await call('status')).session.phase === 'waiting') break;
      await pause(20);
    }
    assert.equal((await call('status')).session.phase, 'waiting');
    if (round === 1 && process.env.TMA_LONG_WAIT_MS) {
      console.log(
        'CLI long poll started; delaying synthetic UI message beyond fetch header deadline',
      );
      await pause(Number(process.env.TMA_LONG_WAIT_MS));
    }
    await perform({ type: 'prepare' });
    await pause(80);
    await panel.webContents.insertText(`CLI往返${round}`);
    await pause(40);
    panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    const result = await receivedByCli;
    assert.equal(result.messages[0].text, `CLI往返${round}`);
    await cli('say', `CLI已回复${round}`);
    await pause(80);
    assert.match(await js('document.body.innerText'), new RegExp(`CLI已回复${round}`));
  }
  assert.equal((await cli('wait', '--timeout', '1')).timeout, true);
  checks.push(
    'spawned CLI start/status, two real textarea -> wait/ack -> say round trips, timeout',
  );
  // Synthetic capture only: getSources never reads the user's desktop.
  const { desktopCapturer, nativeImage } = require('electron');
  const originalSources = desktopCapturer.getSources;
  const originalWrite = fs.writeFile;
  let captures = 0;
  let writesVisible = 0;
  desktopCapturer.getSources = async () => {
    captures++;
    assert.equal(panel.isVisible(), true);
    assert.ok(chrome.every((w) => w.isContentProtected()));
    await pause(80);
    return [
      {
        display_id: String(require('electron').screen.getPrimaryDisplay().id),
        thumbnail: nativeImage.createFromBitmap(Buffer.alloc(4 * 4 * 4, 255), {
          width: 4,
          height: 4,
        }),
      },
    ];
  };
  fs.writeFile = async (file, ...args) => {
    if (String(file).includes(`${path.sep}shots${path.sep}`)) {
      assert.equal(panel.isVisible(), true, 'restore before PNG disk writes');
      writesVisible++;
      await pause(80);
    }
    return originalWrite(file, ...args);
  };
  try {
    await perform({
      type: 'settings',
      settings: { ...initial.settings, attachScreenshot: true, showInScreenCapture: true },
    });
    let hideEvents = 0;
    const onHide = () => hideEvents++;
    chrome.forEach((w) => w.on('hide', onHide));
    const preparedTurns = await js(
      `Promise.all(Array.from({length:3},()=>window.companion.perform({type:'prepare'})))`,
    );
    assert.equal(new Set(preparedTurns.map((s) => s.input.turnId)).size, 1);
    assert.equal(captures, 1);
    assert.equal(writesVisible, 2);
    assert.equal(hideEvents, 0);
    assert.ok(chrome.every((w) => !w.isContentProtected()));
    await pause(100);
    const bounds = panel.getBounds();
    await perform({ type: 'prepare' });
    await pause(100);
    assert.equal(captures, 1, 'editing does not recapture');
    assert.equal(await js('document.activeElement===document.querySelector("textarea")'), true);
    assert.equal(panel.getBounds().height, bounds.height);
    checks.push(
      'concurrent prepare captures once with no window hide; protection restored before writes',
    );
    checks.push('editing refocus keeps stable panel height without recapture');
    await perform({ type: 'cancel' });
    desktopCapturer.getSources = async () => {
      throw new Error('合成截图失败');
    };
    await assert.rejects(perform({ type: 'prepare' }), /合成截图失败/);
    assert.equal(panel.isVisible(), true);
    assert.equal(hideEvents, 0);
    assert.ok(chrome.every((w) => !w.isContentProtected()));
    chrome.forEach((w) => w.removeListener('hide', onHide));
    checks.push('failed capture restores panel visibility');
    await perform({ type: 'cancel' });
  } finally {
    desktopCapturer.getSources = originalSources;
    fs.writeFile = originalWrite;
    await perform({ type: 'settings', settings: initial.settings });
  }
  panel.webContents.setZoomFactor(520 / 460);
  await pause(150);
  assert.equal(
    await js(
      'document.querySelector(".tools").scrollWidth<=document.querySelector(".tools").clientWidth',
    ),
    true,
  );
  checks.push('composer tools fit at 460 CSS pixels');
  panel.webContents.setZoomFactor(1);
  await pause(100);
  const image = await panel.capturePage();
  await fs.writeFile(path.join(home, 'panel.png'), image.toPNG());
  checks.push('application-only panel capture');
  checks.push(...(await require('../../dist/test/html-smoke.cjs').testHtml()));
  await fs.writeFile(
    path.join(home, 'result.json'),
    JSON.stringify(
      {
        passed: true,
        checks,
        limits: [
          'No real screen capture',
          'No external-app foreground restoration assertion',
          'No microphone or multi-display verification',
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks }));
  await call('stop');
}
run().catch(async (e) => {
  console.error(e.stack);
  await fs
    .writeFile(
      path.join(home, 'result.json'),
      JSON.stringify({ passed: false, error: e.message, checks }, null, 2),
    )
    .catch(() => {});
  app.exit(1);
});
