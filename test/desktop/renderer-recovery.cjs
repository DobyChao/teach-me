const { app, BrowserWindow, globalShortcut } = require('electron');
const { spawn } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const shortcutCallbacks = new Map();
globalShortcut.register = (key, callback) => {
  shortcutCallbacks.set(key, callback);
  return true;
};
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const mode = process.env.TMA_RENDERER_RECOVERY_MODE;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, message, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await pause(50);
  }
  throw new Error(message);
}
async function duplicate() {
  const child = spawn(process.execPath, ['dist/host/main.cjs'], {
    env: process.env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (value) => (output += value));
  child.stderr.on('data', (value) => (output += value));
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('duplicate launch did not exit'));
    }, 10000);
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
  assert.match(output, /应用已在运行/);
}
async function run() {
  await app.whenReady();
  const endpoint = await until(
    async () => {
      try {
        const value = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
        return value.pid === process.pid ? value : null;
      } catch {}
    },
    'current host did not publish endpoint',
    15000,
  );
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
      signal: AbortSignal.timeout(5000),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.error);
    return value;
  };
  const session = await call('start', {
    launchSecret: 'renderer-recovery-fixture',
    displayId: (await call('status')).displayId,
    topic: '面板异常恢复验收',
  });
  token = session.token;
  const panel = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().includes('mode=panel'),
  );
  assert.ok(panel, 'panel window exists');
  panel.setTitle('Teach me, Agent · 恢复验收');
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  await call('say', { text: '恢复验收：已经发送的内容应保留，未发送草稿不承诺恢复。' });
  if (mode === 'restart') {
    assert.ok(await js('!!document.querySelector("textarea")'), 'restarted UI is usable');
    console.log('CHECKS_COMPLETE: restart');
    await call('stop');
    return;
  }
  const overlay = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().includes('mode=overlay'),
  );
  const overlayJs = (source) => overlay.webContents.executeJavaScript(source);
  const overlayPid = overlay.webContents.getOSProcessId();
  let boardBefore;
  let boardHash;
  if (mode === 'recovery') {
    await act({ type: 'edit', on: true });
    await until(
      () => overlayJs('!!document.querySelector("[data-testid=toolbar-rectangle]")'),
      'board editor did not mount',
    );
    await overlayJs('document.querySelector("[data-testid=toolbar-rectangle]").click()');
    for (const event of [
      { type: 'mouseDown', x: 400, y: 300, button: 'left', clickCount: 1 },
      { type: 'mouseMove', x: 550, y: 400, button: 'left' },
      { type: 'mouseUp', x: 550, y: 400, button: 'left', clickCount: 1 },
    ]) {
      overlay.webContents.sendInputEvent(event);
      await pause(80);
    }
    await until(async () => (await state()).userBoard.count === 1, 'drawing was not reported');
    await act({ type: 'edit', on: false });
    boardBefore = (await state()).userBoard;
    const png = await overlayJs(`window.companionBoard.export(${boardBefore.epoch})`);
    boardHash = createHash('sha256').update(png).digest('hex');
  }
  await act({ type: 'prepare' });
  await act({
    type: 'submit',
    turnId: (await state()).input.turnId,
    text: 'committed before crash',
    attachBoard: false,
  });
  const pending = await call('wait', { timeoutMs: 1000 });
  assert.deepEqual(
    pending.messages.map((message) => message.text),
    ['committed before crash'],
  );
  // Intentionally leave this delivered message unacknowledged through the crash.
  await act({ type: 'prepare' });
  const oldTurn = (await state()).input.turnId;
  await panel.webContents.insertText('unsent draft may be lost');
  const windowId = panel.id;
  const handle = panel.getNativeWindowHandle().toString('hex');
  const rendererPid = panel.webContents.getOSProcessId();
  const crashedAt = Date.now();
  let loaded = 0;
  let gone = null;
  panel.webContents.on('did-finish-load', () => loaded++);
  panel.webContents.once('render-process-gone', (_event, details) => (gone = details));
  if (['load-failed', 'load-hang'].includes(mode)) {
    panel.loadFile = async () => {
      await assert.rejects(call('capture'), /恢复/);
      await assert.rejects(call('attach', { session: session.id }), /恢复/);
      assert.equal(
        (await call('wait', { timeoutMs: 1000 })).messages[0].id,
        pending.messages[0].id,
      );
      console.log(`CHECKS_COMPLETE: injected ${mode}; require bounded exit 1`);
      if (mode === 'load-failed') throw new Error('injected reload failure');
      return new Promise(() => {});
    };
    panel.webContents.forcefullyCrashRenderer();
    return;
  }
  let deniedCapture;
  let deniedAttach;
  let releaseExport;
  if (mode === 'recovery') {
    const originalExecute = overlay.webContents.executeJavaScript.bind(overlay.webContents);
    let exportPending = false;
    const exportGate = new Promise((resolve) => (releaseExport = resolve));
    overlay.webContents.executeJavaScript = async (source, ...args) => {
      if (source.startsWith('window.companionBoard?.export(')) {
        exportPending = true;
        await exportGate;
      }
      return originalExecute(source, ...args);
    };
    // The old renderer disappears while the host is still waiting for its attachment.
    void act({
      type: 'submit',
      turnId: oldTurn,
      text: 'canceled attachment',
      attachBoard: true,
    }).catch(() => {});
    await until(() => exportPending, 'old submission did not reach export');
    const originalLoad = panel.loadFile.bind(panel);
    panel.loadFile = async (...args) => {
      shortcutCallbacks.get('Control+Alt+W')();
      shortcutCallbacks.get('Control+Alt+H')();
      await pause(400);
      return originalLoad(...args);
    };
    deniedCapture = call('capture').then(
      () => ({ allowed: true }),
      (e) => ({ error: e.message }),
    );
    deniedAttach = call('attach', { session: session.id }).then(
      () => ({ allowed: true }),
      (e) => ({ error: e.message }),
    );
    await until(async () => {
      const s = await state();
      return s.capture && s.connection;
    }, 'capture and connection approvals did not appear');
  }
  console.log(`CRASH_INJECTION: host=${process.pid} panelRenderer=${rendererPid}`);
  panel.webContents.forcefullyCrashRenderer();
  await until(() => gone, 'real renderer crash event was not observed');
  assert.notEqual(gone.reason, 'clean-exit');
  assert.equal((await call('status')).session.id, session.id, 'host session survives');
  await duplicate();
  assert.equal(
    JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8')).pid,
    endpoint.pid,
    'duplicate does not replace host',
  );
  if (mode === 'baseline') {
    await pause(2500);
    assert.equal(loaded, 0, 'baseline must remain unrecovered');
    assert.ok(panel.webContents.isCrashed(), 'panel remains crashed despite live API');
    assert.equal((await call('status')).session.id, session.id);
    console.log('BASELINE: panel is crashed; API/session and single-instance lock remain alive');
    console.log('CHECKS_COMPLETE: baseline');
    await call('stop');
    return;
  }
  await until(
    () => loaded > 0 && !panel.webContents.isCrashed(),
    'panel did not recover after a renderer crash',
  );
  assert.equal(panel.id, windowId, 'recovery keeps BrowserWindow');
  assert.equal(panel.getNativeWindowHandle().toString('hex'), handle, 'recovery keeps HWND');
  await until(
    () => js('!!document.querySelector("textarea")'),
    'restored renderer did not mount its input',
  );
  const recovered = await state();
  assert.ok(
    await js('document.body.textContent.includes("面板已恢复")'),
    'recovery must inform users about unsent content',
  );
  if (mode === 'recovery') {
    assert.match((await deniedCapture).error, /未获允许/);
    assert.match((await deniedAttach).error, /拒绝/);
    assert.equal(recovered.capture, null);
    assert.equal(recovered.connection, null);
    assert.equal(overlay.webContents.getOSProcessId(), overlayPid, 'healthy overlay not reloaded');
    assert.deepEqual(recovered.userBoard, boardBefore, 'board epoch and count retained');
    await act({ type: 'prepare' });
    const newTurn = (await state()).input.turnId;
    releaseExport();
    await pause(500);
    assert.equal((await state()).input.turnId, newTurn, 'old export rejection keeps new input');
    assert.equal((await state()).error, null, 'late old IPC failure cannot overwrite recovered UI');
    const png = await overlayJs(`window.companionBoard.export(${boardBefore.epoch})`);
    assert.equal(
      createHash('sha256').update(png).digest('hex'),
      boardHash,
      'drawing pixels retained',
    );
  }
  assert.equal(recovered.session.id, session.id);
  assert.notEqual(recovered.input.turnId, oldTurn, 'crashed input turn is invalidated');
  assert.equal(recovered.voice.phase, 'idle');
  await assert.rejects(
    act({ type: 'submit', turnId: oldTurn, text: 'stale submission', attachBoard: false }),
    /失效|取消/,
  );
  const retained = await call('wait', { timeoutMs: 1000 });
  assert.deepEqual(
    retained.messages.map((message) => message.id),
    [pending.messages[0].id],
  );
  assert.equal(retained.messages[0].text, 'committed before crash');
  await call('ack', { id: retained.messages[0].id });
  const text = mode === 'interactive' ? 'recovered native message' : 'recovered next message';
  await call('say', { text: `面板已恢复。请在面板输入并发送：${text}` });
  if (mode === 'interactive') {
    panel.setTitle('Teach me, Agent · 恢复验收');
    console.log(`READY: recovered panel; type and send ${text}`);
  } else {
    await act({ type: 'prepare' });
    await until(async () => !(await state()).panelAnimating, 'panel transition did not finish');
    await panel.webContents.insertText(text);
    await js('document.querySelector(".send").click()');
  }
  await until(
    async () =>
      (await state()).messages.some((message) => message.role === 'user' && message.text === text),
    'new message not accepted after recovery',
    mode === 'interactive' ? 300000 : 10000,
  );
  await until(
    async () => (await js('document.querySelector("textarea").value')) === '',
    'sent draft did not clear',
  );
  const next = await call('wait', { timeoutMs: 1000 });
  assert.deepEqual(
    next.messages.map((message) => message.text),
    [text],
  );
  assert.notEqual(next.messages[0].id, pending.messages[0].id);
  await call('ack', { id: next.messages[0].id });
  if (mode === 'repeat') {
    assert.ok(Date.now() - crashedAt < 60000, 'second crash must be inside recovery limit window');
    assert.equal(loaded, 1, 'one crash produces only one reload');
    const deadline = setTimeout(() => {
      console.error('second crash must terminate instead of leaving a broken panel');
      app.exit(2);
    }, 15000);
    app.once('will-quit', () => clearTimeout(deadline));
    panel.webContents.once('render-process-gone', (_event, details) => {
      assert.notEqual(details.reason, 'clean-exit');
      console.log('CHECKS_COMPLETE: second real renderer crash requires bounded exit 1');
    });
    panel.webContents.once('did-finish-load', () => {
      console.error('second crash within 60 seconds must not reload again');
      app.exit(2);
    });
    panel.webContents.forcefullyCrashRenderer();
    return;
  }
  console.log(
    'CHECKS_COMPLETE: same HWND, retained pending message, invalid old turn, new message',
  );
  await call('stop');
}
run().catch((error) => {
  console.error(error);
  app.exit(2);
});
