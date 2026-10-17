// Interactive native acceptance fixture. Covers the teaching display with a
// synthetic background before the operator triggers the real global shortcut.
const { app, BrowserWindow, screen, nativeImage } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const report = (value) =>
  fs.writeFile(path.join(home, 'native-result.json'), JSON.stringify(value));
function cli(...args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['bin/teach-me.mjs', ...args, '--client', 'native-fixture'],
      {
        windowsHide: true,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '',
      error = '';
    child.stdout.on('data', (s) => (output += s));
    child.stderr.on('data', (s) => (error += s));
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code) return reject(new Error(error));
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
  for (let i = 0; i < 100; i++) {
    try {
      endpoint = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      break;
    } catch {
      await pause(100);
    }
  }
  assert.ok(endpoint);
  const display = screen.getPrimaryDisplay();
  const response = await fetch(`http://127.0.0.1:${endpoint.port}/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-companion-token': endpoint.token },
    body: JSON.stringify({
      displayId: display.id,
      topic: '原生快捷键验证',
      launchSecret: process.env.TMA_LAUNCH_SECRET,
    }),
  });
  const driver = await response.json();
  assert.ok(response.ok);
  await fs.mkdir(path.join(home, 'clients'), { recursive: true });
  await fs.writeFile(
    path.join(
      home,
      'clients',
      createHash('sha256').update('native-fixture').digest('hex') + '.json',
    ),
    JSON.stringify(driver),
  );
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const bg = new BrowserWindow({
    ...display.bounds,
    title: 'Teach me native fixture',
    frame: false,
    transparent: true,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  globalThis.nativeBackground = bg;
  await bg.loadURL(
    'data:text/html;charset=utf-8,' +
      encodeURIComponent(
        `<title>Teach me native fixture</title><body style="margin:0;background:transparent;color:white;font:24px sans-serif"><main style="height:${display.workArea.height}px;background:#226644"><span>Teach me native fixture — Ctrl+Alt+W</span></main></body>`,
      ),
  );
  bg.show();
  if (!bg.isVisible()) bg.showInactive();
  bg.setBounds(display.bounds);
  bg.setAlwaysOnTop(true, 'screen-saver');
  bg.moveTop();
  await pause(300);
  assert.equal(bg.isVisible(), true, 'synthetic cover must be visible before any capture');
  assert.equal(
    await bg.webContents.executeJavaScript(
      'getComputedStyle(document.querySelector("main")).backgroundColor',
    ),
    'rgb(34, 102, 68)',
  );
  let hides = 0;
  panel.on('hide', () => hides++);
  await report({
    stage: 'ready',
    displayId: display.id,
    backgroundVisible: bg.isVisible(),
    backgroundBounds: bg.getBounds(),
    backgroundHandle: bg.getNativeWindowHandle().readBigUInt64LE().toString(),
    windowCount: BrowserWindow.getAllWindows().length,
  });
  const waiting = cli('wait', '--timeout', '480');
  let editing;
  for (let i = 0; i < 2400; i++) {
    editing = await panel.webContents.executeJavaScript('window.companion.snapshot()');
    if (editing.input.phase === 'editing') break;
    await pause(100);
  }
  assert.equal(editing.input.phase, 'editing');
  const status = await cli('status');
  const shot = status.shots.at(-1);
  assert.ok(shot, 'real global shortcut captured a frame');
  const image = nativeImage.createFromPath(shot.path);
  const size = image.getSize();
  const bounds = panel.getBounds();
  const bitmap = image.toBitmap();
  // The desktop automation tool draws a cursor halo. Sample the whole panel
  // interior so that a halo at its center cannot invalidate the background check.
  const samples = [
    [0.1, 0.2],
    [0.9, 0.2],
    [0.1, 0.8],
    [0.9, 0.8],
    [0.5, 0.5],
  ].map(([u, v]) => {
    const x = Math.min(
      size.width - 1,
      Math.round(
        ((bounds.x - display.bounds.x + bounds.width * u) / display.bounds.width) * size.width,
      ),
    );
    const y = Math.min(
      size.height - 1,
      Math.round(
        ((bounds.y - display.bounds.y + bounds.height * v) / display.bounds.height) * size.height,
      ),
    );
    const offset = (y * size.width + x) * 4;
    return [...bitmap.subarray(offset, offset + 3)];
  });
  const matching = samples.filter((p) => p[0] === 68 && p[1] === 102 && p[2] === 34).length;
  assert.ok(
    matching >= 4,
    `background must be visible at >=4/5 panel points: ${JSON.stringify(samples)}`,
  );
  const pixel = samples.find((p) => p[0] === 68 && p[1] === 102 && p[2] === 34);
  assert.equal(hides, 0);
  assert.equal(panel.isVisible(), true);
  assert.equal(panel.isFocused(), true);
  await report({
    stage: 'editing',
    hides,
    backgroundPixel: pixel,
    panelFocused: panel.isFocused(),
  });
  const message = await waiting;
  assert.equal(message.messages[0].text, '原生快捷键收发测试');
  await cli('say', '已收到原生快捷键测试，CLI 收发正常。');
  let rendered = false;
  let draftCleared = false;
  for (let i = 0; i < 100; i++) {
    rendered = await panel.webContents.executeJavaScript(
      'document.body.innerText.includes("已收到原生快捷键测试，CLI 收发正常。")',
    );
    draftCleared = await panel.webContents.executeJavaScript(
      'document.querySelector("textarea").value === ""',
    );
    if (rendered && draftCleared) break;
    await pause(100);
  }
  assert.ok(rendered, 'CLI reply must render in the real React panel');
  assert.ok(draftCleared, 'successful native send must clear draft');
  await report({ stage: 'replied', hides, backgroundPixel: pixel, rendered, draftCleared });
  // Keep the fixture available for inspection; caller closes via the CLI.
}
run().catch(async (e) => {
  await report({ stage: 'failed', error: e.message });
  console.error(e.stack);
});
