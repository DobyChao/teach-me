const { app, BrowserWindow, globalShortcut, screen } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const assert = require('node:assert/strict');
const processes = require('node:child_process');
const spawn = processes.spawn;
let native;
const clients = new Set();
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
const driverPath = (name) =>
  path.join(home, 'clients', createHash('sha256').update(name).digest('hex') + '.json');
function cli(name, ...args) {
  const child = spawn(
    process.execPath,
    [path.resolve('bin/teach-me.mjs'), ...args, '--client', name],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  clients.add(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (data) => (stdout += data));
  child.stderr.on('data', (data) => (stderr += data));
  const done = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => {
      clients.delete(child);
      resolve({ code, stdout, stderr });
    });
  });
  return { child, done };
}
async function kill(client) {
  assert.equal(client.child.exitCode, null, 'CLI must still be pending before interruption');
  client.child.kill();
  await client.done;
}
async function run() {
  await app.whenReady();
  let endpoint;
  for (let i = 0; i < 150; i++) {
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
      signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  };
  const panel = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().includes('mode=panel'),
  );
  panel.setTitle('Teach me, Agent · 断连恢复验收');
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  const until = async (predicate, label, timeout = 4000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await predicate()) return;
      await pause(20);
    }
    throw new Error(`connection cancellation condition timed out: ${label}`);
  };
  const pending = (kind) =>
    until(async () => (await state()).connection?.kind === kind, `${kind} approval`);
  const cleared = () =>
    until(async () => !(await state()).connection, 'disconnected approval withdrawn');
  const decide = (allow) => act({ type: 'connection-decision', allow });
  const displayId = (await call('status')).body.displayId;
  const start = (name) =>
    cli(name, 'start', '--topic', '断连恢复验收', '--display', String(displayId));
  const noDriver = async (name) => {
    await assert.rejects(fs.access(driverPath(name)), { code: 'ENOENT' });
  };
  const approved = async (client) => {
    const result = await client.done;
    assert.equal(result.code, 0, 'approved CLI must complete successfully');
    const driver = JSON.parse(result.stdout);
    assert.ok(typeof driver.id === 'string' && typeof driver.token === 'string');
    return driver;
  };

  if (process.argv.includes('--display-race')) {
    const realDisplays = screen.getAllDisplays.bind(screen);
    const physical = realDisplays().find((display) => display.id === displayId);
    assert.ok(physical);
    const syntheticId = Math.max(...realDisplays().map((display) => display.id)) + 10000;
    // Only enumerate a second screen inside this process. Always choose the real screen.
    screen.getAllDisplays = () => [
      ...realDisplays(),
      { ...physical, id: syntheticId, label: 'Fixture enumeration only' },
    ];
    try {
      const old = cli('old-display', 'start', '--topic', '旧选屏请求');
      await pending('start');
      await decide(true);
      await until(async () => (await state()).selectingDisplay, 'old display selection');
      assert.ok(native && !native.killed);
      native.stdout.pause();
      const oldAction = act({ type: 'select-display', id: displayId });
      await until(() => native.stdout.readableLength > 0, 'old selection native response buffered');
      await kill(old);
      await until(async () => !(await state()).selectingDisplay, 'old selection withdrawn');
      await noDriver('old-display');
      const replacement = cli('new-display', 'start', '--topic', '新选屏请求');
      await pending('start');
      await decide(true);
      await until(async () => (await state()).selectingDisplay, 'replacement display selection');
      native.stdout.resume();
      await oldAction;
      assert.equal(
        (await state()).selectingDisplay,
        true,
        'old click must not approve new request',
      );
      assert.equal((await state()).session, null);
      await noDriver('new-display');
      await act({ type: 'select-display', id: displayId });
      const current = await approved(replacement);
      token = current.token;
      assert.equal((await state()).session.id, current.id);
      assert.equal((await state()).selectingDisplay, false);
      console.log(
        'CHECKS_COMPLETE: simulated display enumeration; disconnected old native selection cannot approve replacement',
      );
    } finally {
      native?.stdout.resume();
      screen.getAllDisplays = realDisplays;
    }
    await call('stop');
    return;
  }

  const interrupted = start('cancel-start');
  await pending('start');
  await kill(interrupted);
  await noDriver('cancel-start');
  if (baseline) {
    await pause(150);
    assert.equal((await state()).connection?.kind, 'start');
    await decide(true);
    await until(async () => (await state()).session?.phase === 'ready', 'orphan session created');
    const retry = await start('cancel-start').done;
    assert.equal(retry.code, 1);
    assert.match(retry.stderr, /已有活跃教学/);
    await noDriver('cancel-start');
    console.log(
      'BASELINE_DEFECT: disconnected CLI start created an active session without a driver; retry rejected',
    );
    console.log('CHECKS_COMPLETE');
    await call('stop');
    return;
  }
  await cleared();
  assert.equal((await state()).session, null, 'cancelled initial start must not create a session');
  const refusedStart = start('denied-start');
  await pending('start');
  await decide(false);
  const startRejection = await refusedStart.done;
  assert.equal(startRejection.code, 1);
  assert.match(startRejection.stderr, /拒绝/);
  await noDriver('denied-start');
  assert.equal((await state()).session, null, 'denied start must not create a session');
  const retry = start('cancel-start');
  await pending('start');
  await decide(true);
  const initial = await approved(retry);
  token = initial.token;
  console.log(
    'PASS: CLI interrupted during start approval; prompt withdrawn, no driver, retry succeeds',
  );

  const attaching = cli('cancel-attach', 'attach', '--session', initial.id);
  await pending('attach');
  await kill(attaching);
  await cleared();
  await noDriver('cancel-attach');
  assert.equal((await state()).session.id, initial.id);
  assert.notEqual((await state()).session.phase, 'ended');
  const rejected = cli('denied-attach', 'attach', '--session', initial.id);
  await pending('attach');
  await decide(false);
  const rejection = await rejected.done;
  assert.equal(rejection.code, 1);
  assert.match(rejection.stderr, /拒绝/);
  await noDriver('denied-attach');
  console.log(
    'PASS: interrupted attach withdraws only its approval; original session and normal denial remain',
  );

  await act({ type: 'end' });
  const delayed = start('cancel-native');
  await pending('start');
  assert.ok(native && !native.killed);
  native.stdout.pause();
  try {
    await decide(true);
    await until(() => native.stdout.readableLength > 0, 'real helper response buffered');
    assert.equal((await state()).session.id, initial.id);
    assert.equal((await state()).session.phase, 'ended');
    await kill(delayed);
    // Let the server observe the closed socket while native cancellation is still suspended.
    await pause(100);
    native.stdout.resume();
    await pause(200);
    assert.equal(
      (await state()).session.id,
      initial.id,
      'late start must not replace ended session',
    );
    assert.equal((await state()).session.phase, 'ended');
    await noDriver('cancel-native');
  } finally {
    native.stdout.resume();
  }
  console.log(
    'PASS: CLI interrupted after approval and during native cancellation creates no orphan session',
  );

  const fresh = start('recovered');
  await pending('start');
  if (interactive) {
    await js(`window.__nativeApproval = false;
      document.addEventListener('click', e => {
        if (e.isTrusted && e.target.closest('.request .primary')) window.__nativeApproval = true;
      }, true); true`);
    console.log('READY: click 允许连接 in the native cancellation recovery window');
  } else await decide(true);
  const current = await approved(fresh);
  if (interactive) assert.equal(await js('window.__nativeApproval'), true);
  token = current.token;
  const joined = cli('joined', 'attach', '--session', current.id);
  await pending('attach');
  await decide(true);
  const joinedDriver = await approved(joined);
  assert.ok(joinedDriver.id === current.id && joinedDriver.token === current.token);
  await act({ type: 'prepare' });
  await until(async () => !(await state()).panelAnimating, 'input layout settled');
  await js('document.querySelector("textarea").focus(); true');
  await panel.webContents.insertText('connection cancellation recovered');
  panel.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  panel.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  const received = await cli('recovered', 'wait', '--timeout', '3').done;
  assert.equal(received.code, 0, 'real CLI wait and auto-ack must succeed');
  const messages = JSON.parse(received.stdout).messages;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'connection cancellation recovered');
  await until(
    async () => (await js('document.querySelector("textarea").value')) === '',
    'draft cleared',
  );
  const empty = await call('wait', { timeoutMs: 20 });
  assert.equal(empty.status, 200);
  assert.equal(empty.body.messages.length, 0, 'CLI acknowledged the message');
  console.log(
    'CHECKS_COMPLETE: start and attach interruption, native delay, approve/deny, rendered input, CLI wait/ack',
  );
  await call('stop');
}
run().catch((error) => {
  native?.stdout.resume();
  for (const child of clients) child.kill();
  console.error(error);
  app.exit(1);
});
