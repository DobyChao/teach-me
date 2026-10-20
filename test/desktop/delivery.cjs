const { app, BrowserWindow, globalShortcut, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
globalShortcut.register = () => true;
// Hold only the completed submit response, allowing a new turn before the old UI callback.
const handle = ipcMain.handle.bind(ipcMain);
let holdReply = null;
let replyPending = false;
ipcMain.handle = (channel, callback) =>
  handle(channel, async (event, value) => {
    const gate = channel === 'companion:action' && value?.type === 'submit' ? holdReply : null;
    const result = await callback(event, value);
    if (gate) {
      replyPending = true;
      await gate;
    }
    return result;
  });
require('../../dist/host/main.cjs');
const interactive = process.argv.includes('--interactive');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(read, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await read();
    if (result) return result;
    await pause(50);
  }
  throw new Error('delivery condition timed out');
}
async function run() {
  await app.whenReady();
  const endpoint = await until(async () => {
    try {
      return JSON.parse(
        await fs.readFile(path.join(process.env.TEACH_ME_AGENT_HOME, 'endpoint.json'), 'utf8'),
      );
    } catch {}
  }, 15000);
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
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  token = (
    await call('start', {
      launchSecret: 'delivery-fixture',
      displayId: (await call('status')).displayId,
      topic: '消息投递恢复验收',
    })
  ).token;
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (a) => js(`window.companion.perform(${JSON.stringify(a)})`);
  await call('say', {
    text: '消息恢复验收：请发送 first message，观察反馈，再发送 next message。',
  });
  await act({ type: 'prepare' });
  await until(async () => !(await state()).panelAnimating);
  const firstTurn = (await state()).input.turnId;
  const nativeHandle = panel.getNativeWindowHandle.bind(panel);
  panel.getNativeWindowHandle = () => {
    throw new Error('injected native window failure');
  };
  console.log('READY: first message');
  if (!interactive) {
    await panel.webContents.insertText('first message');
    await js('document.querySelector(".send").click()');
  }
  await until(
    async () => (await state()).input.error?.includes('消息已发送'),
    interactive ? 300000 : 5000,
  );
  panel.getNativeWindowHandle = nativeHandle;
  await until(async () => (await js('document.querySelector("textarea").value')) === '');
  assert.equal((await state()).input.turnId, null);
  assert.match(await js('document.querySelector("[role=alert]").textContent'), /已发送.*焦点/);
  await assert.rejects(
    act({ type: 'submit', turnId: firstTurn, text: 'edited retry', attachBoard: false }),
    /失效/,
  );
  const first = await call('wait', { timeoutMs: 1000 });
  assert.equal(first.messages.length, 1);
  assert.equal(first.messages[0].text, 'first message');
  await call('ack', { id: first.messages[0].id });
  console.log('VERIFIED: first sent once, draft cleared; READY: next message');
  if (!interactive) {
    await act({ type: 'prepare' });
    await until(async () => !(await state()).panelAnimating);
    await panel.webContents.insertText('next message');
    await js('document.querySelector(".send").click()');
  }
  await until(
    async () => (await state()).messages.filter((m) => m.role === 'user').length === 2,
    interactive ? 300000 : 5000,
  );
  await until(async () => (await js('document.querySelector("textarea").value')) === '');
  const next = await call('wait', { timeoutMs: 1000 });
  assert.equal(next.messages.length, 1);
  assert.equal(next.messages[0].text, 'next message');
  assert.notEqual(next.messages[0].id, first.messages[0].id);
  await call('ack', { id: next.messages[0].id });
  assert.equal((await state()).input.error, null);
  let releaseReply;
  holdReply = new Promise((resolve) => (releaseReply = resolve));
  await act({ type: 'prepare' });
  await until(async () => !(await state()).panelAnimating);
  await panel.webContents.insertText('slow prior message');
  await js('document.querySelector(".send").click()');
  await until(() => replyPending);
  await act({ type: 'prepare' });
  const newerTurn = (await state()).input.turnId;
  await js('document.querySelector("textarea").select()');
  await panel.webContents.insertText('new draft survives');
  holdReply = null;
  releaseReply();
  await until(async () => !(await js('document.querySelector(".send").disabled')));
  assert.equal(await js('document.querySelector("textarea").value'), 'new draft survives');
  assert.equal(
    await js('document.activeElement === document.querySelector("textarea")'),
    true,
    'late completion must not blur the next editing turn',
  );
  assert.equal((await state()).input.turnId, newerTurn);
  await js('document.querySelector(".send").click()');
  await until(async () => (await js('document.querySelector("textarea").value')) === '');
  const concurrent = await call('wait', { timeoutMs: 1000 });
  assert.deepEqual(
    concurrent.messages.map((m) => m.text),
    ['slow prior message', 'new draft survives'],
  );
  await call('ack', { id: concurrent.messages.at(-1).id });
  console.log('VERIFIED: delayed old completion preserves newer draft, focus and delivery');
  console.log('CHECKS_COMPLETE');
  await call('stop');
}
run().catch((e) => {
  console.error(e);
  app.exit(1);
});
