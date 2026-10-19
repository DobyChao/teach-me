const { app, BrowserWindow, screen, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
globalShortcut.register = () => true;
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
  const call = async (route, data = {}) => {
    const r = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-companion-token': endpoint.token },
      body: JSON.stringify(data),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    return result;
  };
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const js = (code) => panel.webContents.executeJavaScript(code);
  const settle = async () => {
    await pause(40);
    for (let i = 0; i < 100; i++) {
      if (!(await js('window.companion.snapshot().then(s=>s.panelAnimating)'))) {
        await pause(40);
        if (!(await js('window.companion.snapshot().then(s=>s.panelAnimating)'))) return;
      }
      await pause(20);
    }
    throw new Error('mini panel animation did not settle');
  };
  const perform = async (a) => {
    const result = await js(`window.companion.perform(${JSON.stringify(a)})`);
    await settle();
    return result;
  };
  await pause(250);
  await perform({ type: 'panel-mode', mode: 'compose' });
  const first = panel.getBounds();
  const identity = panel.getNativeWindowHandle().toString('hex');
  const clipped = () =>
    js(
      `(()=>{const p=document.querySelector('.panel');const c=document.querySelector('.composer');return p.getBoundingClientRect().bottom>innerHeight+1||c.scrollWidth>c.clientWidth})()`,
    );
  assert.ok(Math.abs(first.width - 360) <= 1, JSON.stringify(first));
  assert.ok(first.height <= 90, JSON.stringify(first));
  assert.equal(await clipped(), false);
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.header')).webkitAppRegion`),
    'no-drag',
  );
  assert.equal(
    await js(`getComputedStyle(document.querySelector('.composer')).webkitAppRegion`),
    'no-drag',
  );
  await fs.writeFile(
    path.join(home, process.env.TMA_MINI_RESUME ? 'mini-restored.png' : 'mini-empty.png'),
    (await panel.capturePage()).toPNG(),
  );
  checks.push('360 DIP mini layout under 90 DIP high; pointer drag header excludes composer');
  if (process.env.TMA_MINI_RESUME) {
    const saved = JSON.parse(await fs.readFile(path.join(home, 'panel-position.json'), 'utf8'));
    assert.ok(Math.abs(first.x + first.width - saved.right) <= 1);
    assert.ok(Math.abs(first.y + first.height - saved.bottom) <= 1);
    checks.push('restarted process restores the saved window anchor');
  } else {
    await js(`document.querySelector('[aria-label="更多工具"]').click()`);
    await settle();
    assert.ok(panel.getBounds().height > first.height);
    assert.equal(await js(`document.querySelector('.aux-tools').hidden`), false);
    assert.equal(await clipped(), false);
    await fs.writeFile(path.join(home, 'mini-tools.png'), (await panel.capturePage()).toPNG());
    await js(`document.querySelector('[aria-label="更多工具"]').click()`);
    await settle();
    assert.equal(panel.getBounds().height, first.height);
    checks.push('overflow controls remain reachable and resize back without clipping');
    const status = await call('status');
    await call('start', { launchSecret: 'mini-panel-test', displayId: status.displayId });
    await perform({ type: 'prepare' });
    await pause(100);
    await panel.webContents.insertText('第一行小窗口\n第二行保留草稿\n第三行继续输入');
    await settle();
    assert.ok(panel.getBounds().height > first.height);
    await js(
      `window.__miniInput=document.querySelector('textarea');window.__miniInput.setSelectionRange(2,6);true`,
    );
    const selection = await js(
      `({value:window.__miniInput.value,start:window.__miniInput.selectionStart,end:window.__miniInput.selectionEnd})`,
    );
    await perform({ type: 'toggle-expanded' });
    await pause(150);
    assert.ok(Math.abs(panel.getBounds().width - 520) <= 1);
    assert.equal(await clipped(), false);
    await fs.writeFile(path.join(home, 'mini-expanded.png'), (await panel.capturePage()).toPNG());
    await perform({ type: 'toggle-expanded' });
    await pause(150);
    assert.equal(await js(`window.__miniInput===document.querySelector('textarea')`), true);
    assert.deepEqual(
      await js(
        `({value:window.__miniInput.value,start:window.__miniInput.selectionStart,end:window.__miniInput.selectionEnd})`,
      ),
      selection,
    );
    checks.push('multiline mini and expanded view preserve the same composer, draft and selection');
    await perform({ type: 'cancel' });
    // Exercise validated drag IPC; the separate interactive phase uses real mouse events.
    const area = screen.getPrimaryDisplay().workArea;
    const b = panel.getBounds();
    const dragId = require('node:crypto').randomUUID();
    const drag = { type: 'panel-drag', dragId, dx: 0, dy: 0 };
    await perform({ ...drag, phase: 'start' });
    const delta = {
      dx: area.x + area.width - b.width - 100 - b.x,
      dy: area.y + area.height - b.height - 100 - b.y,
    };
    await perform({ ...drag, ...delta, phase: 'move' });
    await perform({ ...drag, ...delta, phase: 'end' });
    const settled = panel.getBounds();
    await perform({ ...drag, dx: 500, dy: 500, phase: 'move' });
    assert.deepEqual(panel.getBounds(), settled, 'late drag callback must be ignored');
    await perform({
      type: 'resize',
      height: 500,
      mode: 'conversation',
      layoutVersion: await js('window.companion.snapshot().then(s=>s.panelLayoutVersion)'),
    });
    assert.deepEqual(panel.getBounds(), settled, 'stale expanded resize must be ignored');
    await pause(120);
    const saved = JSON.parse(await fs.readFile(path.join(home, 'panel-position.json'), 'utf8'));
    for (let i = 0; i < 2; i++) {
      await perform({ type: 'toggle-expanded' });
      await pause(120);
      const current = panel.getBounds();
      assert.ok(Math.abs(current.x + current.width - saved.right) <= 1);
      assert.ok(Math.abs(current.y + current.height - saved.bottom) <= 1);
    }
    assert.equal(panel.getNativeWindowHandle().toString('hex'), identity);
    checks.push('drag persistence, stale callbacks and resize keep the anchor and original window');
  }
  await fs.writeFile(
    path.join(home, process.env.TMA_MINI_RESUME ? 'mini-resume-result.json' : 'mini-result.json'),
    JSON.stringify({ passed: true, checks }),
  );
  console.log(JSON.stringify({ passed: true, checks, bounds: panel.getBounds() }));
  if (process.env.TMA_MINI_RESUME && process.env.TMA_MINI_INTERACTIVE) {
    let reporting = false;
    const timer = setInterval(async () => {
      if (reporting) return;
      reporting = true;
      try {
        await fs.writeFile(
          path.join(home, 'native-state.json'),
          JSON.stringify({
            bounds: panel.getBounds(),
            identity,
            state: await js(
              `window.companion.snapshot().then(s=>({collapsed:s.collapsed,input:s.input.phase}))`,
            ),
          }),
        );
      } catch {
      } finally {
        reporting = false;
      }
    }, 250);
    app.once('will-quit', () => clearInterval(timer));
    return;
  }
  await call('stop');
}
run().catch(async (e) => {
  console.error(e.stack);
  await fs.writeFile(
    path.join(home, 'mini-result.json'),
    JSON.stringify({ passed: false, error: e.message, checks }),
  );
  app.exit(1);
});
