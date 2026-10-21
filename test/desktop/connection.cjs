const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const processes = require('node:child_process');
const spawn = processes.spawn;
let native;
processes.spawn = (...args) => {
  const child = spawn(...args);
  if (/powershell/i.test(String(args[0]))) native = child;
  return child;
};
globalShortcut.register = () => true;
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const baseline = process.argv.includes('--baseline');
const interactive = process.argv.includes('--interactive');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  let endpoint;
  for (let i = 0; i < 150; i++) {
    try {
      const e = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      if (e.pid === process.pid) {
        endpoint = e;
        break;
      }
    } catch {}
    await pause(100);
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
      signal: AbortSignal.timeout(interactive ? 90000 : 8000),
    });
    return { status: r.status, body: await r.json() };
  };
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  panel.setTitle('Teach me, Agent · 连接验收');
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  const until = async (predicate) => {
    for (let i = 0; i < 150; i++) {
      if (await predicate()) return;
      await pause(20);
    }
    throw new Error('connection fixture condition timed out');
  };
  const decide = (allow) => act({ type: 'connection-decision', allow });
  const denied = (response) => {
    assert.notEqual(response.status, 200);
    assert.equal(response.body.token, undefined);
    assert.equal(response.body.id, undefined);
  };
  const displayId = (await call('status')).body.displayId;
  const first = await call('start', {
    launchSecret: 'connection-fixture',
    topic: '连接边界验收',
    displayId,
  });
  assert.equal(first.status, 200);
  token = first.body.token;
  const accepted = call('attach', { session: first.body.id });
  await until(async () => !!(await state()).connection);
  if (interactive) console.log('READY: click 允许连接 in the native connection test window');
  else await decide(true);
  const approved = (await accepted).body;
  assert.ok(approved.id === first.body.id && approved.token === token, 'approved target matches');
  const refused = call('attach', { session: first.body.id });
  await until(async () => !!(await state()).connection);
  await decide(false);
  denied(await refused);
  await act({ type: 'end' });

  // Delay a real native helper response during the new start's input cancellation.
  // The old ended Session remains current while another attach arrives.
  const starting = call('start', { topic: '新会话', displayId });
  await until(async () => (await state()).connection?.kind === 'start');
  assert.ok(native && !native.killed);
  native.stdout.pause();
  try {
    await decide(true);
    assert.equal((await state()).session.id, first.body.id);
    const stale = call('attach', { session: first.body.id });
    if (baseline) {
      await until(async () => (await state()).connection?.kind === 'attach');
      native.stdout.resume();
      const next = await starting;
      assert.equal(next.status, 200);
      assert.notEqual(next.body.id, first.body.id);
      await decide(true);
      const wrong = await stale;
      assert.equal(wrong.status, 200);
      assert.ok(wrong.body.id === next.body.id && wrong.body.token === next.body.token);
      console.log('BASELINE_DEFECT: old-session attach returned replacement credentials');
      console.log('CHECKS_COMPLETE');
      await call('stop');
      return;
    }
    denied(await stale);
    assert.equal((await state()).connection, null);
    native.stdout.resume();
    const next = await starting;
    assert.equal(next.status, 200);
    token = next.body.token;
    const pending = call('attach', { session: next.body.id });
    await until(async () => (await state()).connection?.kind === 'attach');
    await act({ type: 'end' });
    await decide(true);
    denied(await pending);
    denied(await call('attach', { session: next.body.id }));
    assert.equal((await state()).connection, null);
  } finally {
    native.stdout.resume();
  }
  // A fresh normal connection must remain usable after the rejection paths.
  const fresh = call('start', { topic: '恢复后的连接', displayId });
  await until(async () => !!(await state()).connection);
  await decide(true);
  const current = (await fresh).body;
  token = current.token;
  const joining = call('attach', { session: current.id });
  await until(async () => !!(await state()).connection);
  await decide(true);
  const joined = (await joining).body;
  assert.ok(joined.id === current.id && joined.token === token, 'reconnected target matches');
  await act({ type: 'prepare' });
  await act({
    type: 'submit',
    turnId: (await state()).input.turnId,
    text: 'approved session delivery',
    attachBoard: false,
  });
  const received = await call('wait', { timeoutMs: 1000 });
  assert.equal(received.body.messages[0].text, 'approved session delivery');
  assert.equal((await call('ack', { id: received.body.messages[0].id })).status, 200);
  console.log(
    'CHECKS_COMPLETE: approve, deny, ended, replacement race, end during consent, delivery',
  );
  await call('stop');
}
run().catch((error) => {
  native?.stdout.resume();
  console.error(error);
  app.exit(1);
});
