const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
globalShortcut.register = () => true; // Isolated UI test; leave the user's running hotkeys alone.
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
async function run() {
  await app.whenReady();
  async function until(read, predicate = Boolean) {
    for (let i = 0; i < 150; i++) {
      const value = await read();
      if (predicate(value)) return value;
      await pause(30);
    }
    throw new Error('panel condition timed out');
  }
  const endpoint = await until(async () => {
    try {
      return JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
    } catch {
      return null;
    }
  });
  let sessionToken;
  const call = async (route, data = {}) => {
    const response = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': endpoint.token,
        ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
      },
      body: JSON.stringify(data),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const identity = panel.getNativeWindowHandle().toString('hex');
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const perform = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  const settled = async () => {
    await until(state, (s) => !s.panelAnimating);
    await pause(100);
  };
  const mode = async (value) => {
    await perform({ type: 'panel-mode', mode: value });
    await settled();
  };
  const capture = (name) =>
    panel.capturePage().then((png) => fs.writeFile(path.join(home, `${name}.png`), png.toPNG()));
  const unclipped = () =>
    js(
      `(()=>{const p=document.querySelector('.panel');return p.getBoundingClientRect().bottom<=innerHeight+1 && p.scrollWidth<=innerWidth+1})()`,
    );
  await settled();
  await fs.writeFile(path.join(home, 'initial-state.json'), JSON.stringify(await state()));
  assert.equal((await state()).panelMode, 'mini');
  assert.ok(Math.abs(panel.getBounds().width - 120) <= 1);
  assert.ok(Math.abs(panel.getBounds().height - 48) <= 1);
  assert.equal(await unclipped(), true);
  await js('window.__originalComposer=document.querySelector("textarea");true');
  await capture('small');
  let hides = 0,
    shows = 0;
  panel.on('hide', () => hides++);
  panel.on('show', () => shows++);
  const frames = [];
  const timer = setInterval(() => frames.push(panel.getBounds()), 16);
  let nativeWrites = 0;
  const setBounds = panel.setBounds.bind(panel);
  panel.setBounds = (...args) => {
    nativeWrites++;
    return setBounds(...args);
  };
  await js(
    `window.__visualFrames=[];window.__sampleMotion=true;requestAnimationFrame(function sample(t){if(!window.__sampleMotion)return;const r=document.querySelector('.panel-frame').getBoundingClientRect();window.__visualFrames.push({at:t,width:r.width,height:r.height});requestAnimationFrame(sample)});true`,
  );
  const initial = await state();
  sessionToken = (
    await call('start', { launchSecret: 'panel-modes-test', displayId: initial.displayId })
  ).token;
  await js('document.querySelector(".mini-write").click()');
  await until(state, (s) => s.input.phase === 'editing');
  await settled();
  clearInterval(timer);
  panel.setBounds = setBounds;
  await js('window.__sampleMotion=false;true');
  const visualFrames = await js('window.__visualFrames');
  await fs.writeFile(
    path.join(home, 'transition-metrics.json'),
    JSON.stringify({ nativeWrites, visualFrames }),
  );
  assert.equal((await state()).panelMode, 'compose');
  assert.ok(Math.abs(panel.getBounds().width - 360) <= 1);
  assert.ok(
    panel.getBounds().height <= 90,
    'empty composer must be measured after the width animation',
  );
  assert.equal(await unclipped(), true);
  assert.ok(
    visualFrames.filter((b) => b.width > 121 && b.width < 359).length >= 3,
    'composited visual frame has continuous intermediate widths',
  );
  assert.ok(
    nativeWrites <= 4,
    `native allocation must be bounded rather than per-frame: ${nativeWrites}`,
  );
  checks.push(
    '120x48 pill opens 360 composer through composited visual frames, with bounded native allocations',
  );
  await panel.webContents.insertText('保留我的草稿与选区');
  await until(
    () => js(`document.querySelector('textarea').value`),
    (v) => v.length > 0,
  );
  await pause(100);
  await js(`window.__originalComposer.setSelectionRange(2,6);true`);
  await call('say', { text: '新回复来了，但正在输入时保持中号，不打断草稿。' });
  await settled();
  assert.equal((await state()).panelMode, 'compose');
  assert.equal((await state()).unreadReply, true);
  await capture('medium');
  await mode('conversation');
  assert.equal(await unclipped(), true);
  assert.equal((await state()).unreadReply, false);
  assert.equal(
    await js('document.activeElement===window.__originalComposer'),
    true,
    'expanding an active input restores the same composer focus',
  );
  assert.equal(await js('window.__originalComposer===document.querySelector("textarea")'), true);
  assert.deepEqual(
    await js(
      '({start:window.__originalComposer.selectionStart,end:window.__originalComposer.selectionEnd})',
    ),
    { start: 2, end: 6 },
  );
  await capture('large');
  checks.push(
    'reply while typing stays medium with unread marker; full conversation preserves composer and selection',
  );
  await mode('mini');
  assert.equal((await state()).input.phase, 'idle');
  assert.equal(await js('window.__originalComposer.value'), '保留我的草稿与选区');
  await mode('compose');
  panel.blur();
  await perform({ type: 'hover', on: false });
  await pause(1300);
  assert.equal((await state()).panelMode, 'compose', 'idle draft cannot disappear');
  checks.push('manual mini keeps the draft; idle compaction cannot conceal unsent text');
  await perform({ type: 'prepare' });
  await settled();
  await js('document.querySelector(".send").click()');
  await until(
    () => js('window.__originalComposer.value'),
    (v) => v === '',
  );
  const delivery = await call('wait', { timeoutMs: 1000 });
  assert.equal(delivery.messages[0].text, '保留我的草稿与选区');
  await call('ack', { id: delivery.messages[0].id });
  await call('say', { text: '继续操作。' });
  await settled();
  assert.equal((await state()).panelMode, 'conversation');
  panel.blur();
  await perform({ type: 'hover', on: false });
  await until(state, (s) => s.panelMode === 'mini');
  await settled();
  await perform({ type: 'hover', on: true });
  await pause(300);
  assert.equal((await state()).panelMode, 'mini');
  checks.push(
    'real submit clears only after delivery; reply opens large; idle returns small; hover does not expand',
  );
  const approval = call('capture').then(
    () => false,
    () => true,
  );
  await until(state, (s) => !!s.capture);
  await settled();
  assert.equal((await state()).panelMode, 'conversation');
  await mode('mini');
  assert.equal((await state()).panelMode, 'conversation');
  await perform({ type: 'capture-decision', decision: 'deny' });
  assert.equal(await approval, true);
  checks.push('approval opens large and cannot be compacted before a decision');
  await perform({ type: 'panel-context', hasDraft: false, toolsOpen: false, reducedMotion: true });
  await mode('mini');
  await perform({ type: 'panel-mode', mode: 'compose' });
  assert.equal((await state()).panelAnimating, false);
  await settled();
  assert.equal(panel.getNativeWindowHandle().toString('hex'), identity);
  assert.equal(hides, 0);
  assert.equal(shows, 0);
  checks.push('reduced motion switches directly; HWND is stable with zero hide/show');
  await fs.writeFile(path.join(home, 'result.json'), JSON.stringify({ passed: true, checks }));
  console.log(JSON.stringify({ passed: true, checks }));
  if (process.env.TMA_PANEL_INTERACTIVE) {
    await perform({
      type: 'panel-context',
      hasDraft: false,
      toolsOpen: false,
      reducedMotion: await js(`matchMedia('(prefers-reduced-motion: reduce)').matches`),
    });
    await perform({
      type: 'settings',
      settings: { ...(await state()).settings, autoCollapseSec: 8 },
    });
    await mode('mini');
    const t = setInterval(async () => {
      try {
        await fs.writeFile(
          path.join(home, 'native-state.json'),
          JSON.stringify({
            identity,
            bounds: panel.getBounds(),
            focusedTag: await js('document.activeElement?.tagName'),
            state: await state(),
          }),
        );
      } catch {}
    }, 400);
    app.once('will-quit', () => clearInterval(t));
  } else await call('stop');
}
run().catch(async (e) => {
  console.error(e.stack);
  await fs.writeFile(
    path.join(home, 'result.json'),
    JSON.stringify({ passed: false, error: e.message, checks }),
  );
  app.exit(1);
});
