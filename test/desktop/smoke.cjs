// Runs inside Electron against the real host and renderer. No desktop capture:
// the isolated settings file disables screen attachments before launch.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
require('../../dist/host/main.cjs');
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const home = process.env.TEACH_ME_AGENT_HOME;
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
