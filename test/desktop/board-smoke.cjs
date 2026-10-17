const { app, BrowserWindow, nativeImage, desktopCapturer, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];
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
  let token = '';
  const call = async (route, data = {}) => {
    const r = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': endpoint.token,
        'x-session-token': token,
      },
      body: JSON.stringify(data),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    return result;
  };
  const status = await call('status');
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const overlay = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=overlay'),
  );
  overlay.webContents.on('console-message', (event) => {
    if (event.level === 'error') console.error('BOARD:', event.message);
  });
  const backdrop = new BrowserWindow({
    ...screen.getPrimaryDisplay().bounds,
    frame: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  await backdrop.loadURL(
    'data:text/html,<body style="background:%23e9edf3;font:24px sans-serif;color:%23636a78;padding:48px">用户画板 · 本地编辑验证<br><small>此背景由测试生成，无真实桌面内容</small></body>',
  );
  const js = (code) => overlay.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const perform = (a) =>
    panel.webContents.executeJavaScript(`window.companion.perform(${JSON.stringify(a)})`);
  await perform({ type: 'edit', on: true });
  for (let i = 0; i < 150; i++) {
    if (await js('!!document.querySelector(".excalidraw canvas")')) break;
    await pause(100);
  }
  assert.equal(await js('!!document.querySelector(".excalidraw canvas")'), true);
  assert.equal(await js('document.querySelector(".excalidraw").style.backgroundColor'), '');
  checks.push('local Excalidraw editor mounted');
  // No production test API: exercise the actual toolbar and Electron pointer events.
  const select = async (tool) => {
    const found = await js(
      `(()=>{const e=document.querySelector('[data-testid="toolbar-${tool}"]');if(!e)return false;e.click();return true})()`,
    );
    assert.equal(found, true, `tool ${tool} exists`);
    await pause(80);
  };
  const drag = async (x, y, dx, dy) => {
    overlay.webContents.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
    await pause(30);
    overlay.webContents.sendInputEvent({ type: 'mouseMove', x: x + dx, y: y + dy, button: 'left' });
    await pause(30);
    overlay.webContents.sendInputEvent({
      type: 'mouseUp',
      x: x + dx,
      y: y + dy,
      button: 'left',
      clickCount: 1,
    });
    await pause(200);
  };
  await select('rectangle');
  await drag(400, 300, 160, 100);
  assert.equal((await state()).userBoard.count, 1);
  checks.push('rectangle drawn with real editor tool and pointer input');
  token = (
    await call('start', {
      displayId: status.displayId,
      launchSecret: 'board-smoke',
      topic: '用户画板编辑回归',
    })
  ).token;
  assert.equal((await state()).userBoard.count, 1);
  checks.push('user can draw offline; the first Agent connection preserves that drawing');
  await select('arrow');
  await drag(650, 320, 150, 80);
  assert.equal((await state()).userBoard.count, 2);
  checks.push('arrow added independently');
  await js('document.querySelector("[data-testid=button-undo]").click()');
  await pause(150);
  assert.equal((await state()).userBoard.count, 1);
  await js('document.querySelector("[data-testid=button-redo]").click()');
  await pause(150);
  assert.equal((await state()).userBoard.count, 2);
  checks.push('library undo and redo update host board presence');
  await select('ellipse');
  await js(
    `document.querySelector('[data-testid="strokeWidth-bold"]').click(); document.querySelector('[data-testid="color-top-pick-#1971c2"]').click()`,
  );
  await drag(850, 300, 120, 80);
  assert.equal((await state()).userBoard.count, 3);
  await select('freedraw');
  await drag(450, 510, 130, 50);
  assert.equal((await state()).userBoard.count, 4);
  await select('text');
  await drag(650, 510, 0, 0);
  await pause(100);
  assert.equal(await js('document.activeElement?.tagName'), 'TEXTAREA');
  await overlay.webContents.insertText('用户画板测试');
  overlay.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
  overlay.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
  await pause(150);
  assert.equal((await state()).userBoard.count, 5);
  checks.push('ellipse, styled pen and Chinese text use the native editor');
  await perform({ type: 'edit', on: true });
  await select('eraser');
  await drag(450, 510, 80, 35);
  assert.equal((await state()).userBoard.count, 4);
  checks.push('eraser removes user content');
  const before = (await state()).userBoard;
  const data = await js(`window.companionBoard.export(${before.epoch})`);
  const png = nativeImage.createFromDataURL(data);
  assert.equal(png.isEmpty(), false);
  await fs.writeFile(path.join(home, 'board-export.png'), png.toPNG());
  const bitmap = png.toBitmap();
  assert.ok(
    bitmap.some((v, index) => index % 4 === 3 && v > 0),
    'drawing is present',
  );
  assert.equal(bitmap[3], 0, 'export has a transparent viewport background');
  checks.push('transparent viewport PNG contains drawing without toolbar');
  await perform({ type: 'edit', on: false });
  await pause(100);
  assert.equal((await state()).userBoard.count, 4);
  assert.equal(
    await js('getComputedStyle(document.querySelector(".layer-ui__wrapper")).display'),
    'none',
  );
  await perform({ type: 'edit', on: true });
  await pause(100);
  assert.equal((await state()).userBoard.count, 4);
  checks.push('finish/reopen preserves elements and hides editor chrome while viewing');
  await perform({ type: 'edit', on: false });
  const prepared = await perform({ type: 'prepare' });
  await perform({
    type: 'submit',
    turnId: prepared.input.turnId,
    text: '请看我画的图',
    attachBoard: true,
  });
  const reply = await call('wait', { timeoutMs: 1000 });
  assert.equal(reply.messages[0].shots.length, 1);
  const attached = nativeImage.createFromPath(reply.messages[0].shots[0].path);
  assert.deepEqual(attached.getSize(), png.getSize());
  assert.ok(attached.toBitmap().some((v, index) => index % 4 === 3 && v > 0));
  checks.push('real submit attaches the editor drawing through the existing CLI message queue');
  desktopCapturer.getSources = async () => [
    {
      display_id: String(status.displayId),
      thumbnail: nativeImage.createFromBitmap(Buffer.alloc(64, 255), { width: 4, height: 4 }),
    },
  ];
  const current = await state();
  await perform({ type: 'settings', settings: { ...current.settings, captureTier: 'always' } });
  await call('capture');
  await call('show', {
    say: '这是独立的 Agent 笔迹',
    items: [
      {
        type: 'stroke',
        points: [
          [0.2, 2],
          [1, 2],
        ],
      },
    ],
  });
  await pause(100);
  const withAgent = (await state()).guides;
  await assert.rejects(perform({ type: 'board-change', epoch: before.epoch, count: 50 }), /sender/);
  await perform({ type: 'clear', layer: 'user' });
  await pause(150);
  assert.equal((await state()).userBoard.count, 0);
  assert.deepEqual((await state()).guides, withAgent);
  await js(`window.companion.perform({type:'board-change',epoch:${before.epoch},count:2})`);
  assert.equal((await state()).userBoard.count, 0);
  await assert.rejects(js(`window.companionBoard.export(${before.epoch})`), /变更|清除/);
  checks.push('sender validation and epoch prevent stale callbacks restoring cleared board');
  checks.push('clearing user board preserves the separate Agent layer');
  await perform({ type: 'edit', on: true });
  await js('document.querySelector("[data-testid=button-undo]")?.click()');
  await pause(100);
  assert.equal(
    (await state()).userBoard.count,
    0,
    'cleared editor history cannot restore old content',
  );
  const exportedAgent = nativeImage.createFromDataURL(
    await js(`window.companionBoard.export(${(await state()).userBoard.epoch})`),
  );
  const [pixelX, pixelY] = withAgent[0].points[0];
  const scale = screen.getPrimaryDisplay().scaleFactor;
  const region = exportedAgent.crop({
    x: Math.round((pixelX + 15) * scale),
    y: Math.round(pixelY * scale),
    width: 1,
    height: 1,
  });
  assert.ok(region.toBitmap()[3] > 0, 'Agent export stays at its original screen coordinates');
  checks.push('clearing resets editor history; Agent raster export retains display coordinates');
  await fs.writeFile(
    path.join(home, 'board-result.json'),
    JSON.stringify({ passed: true, checks }),
  );
  console.log(JSON.stringify({ passed: true, checks }));
  if (process.env.TMA_BOARD_INTERACTIVE) {
    await call('clear');
    const native = new (require('../../dist/test/window-policy-smoke.cjs').WindowStyleProbe)();
    await native.makeTargetable(overlay);
    native.dispose();
    overlay.focus();
    overlay.webContents.focus();
    await pause(150);
    console.log(
      JSON.stringify({
        nativeFocused: overlay.isFocused(),
        contentFocused: overlay.webContents.isFocused(),
        domFocus: await js('document.hasFocus()'),
      }),
    );
    await fs.writeFile(path.join(home, 'board-editor.png'), (await overlay.capturePage()).toPNG());
    await fs.writeFile(
      path.join(home, 'board-ready.json'),
      JSON.stringify({ pid: process.pid, stage: 'interactive' }),
    );
    return;
  }
  await call('stop');
}
run().catch(async (e) => {
  console.error(e.stack);
  await fs.writeFile(
    path.join(home, 'board-result.json'),
    JSON.stringify({ passed: false, error: e.message, checks }),
  );
  app.exit(1);
});
