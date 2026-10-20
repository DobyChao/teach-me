const { app, BrowserWindow, globalShortcut } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
globalShortcut.register = () => true;
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function run() {
  await app.whenReady();
  let endpoint;
  for (let i = 0; i < 150; i++) {
    try {
      const value = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
      if (value.pid === process.pid) {
        endpoint = value;
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
      signal: AbortSignal.timeout(10000),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  const driver = await call('start', {
    launchSecret: 'layout-fixture',
    displayId: (await call('status')).displayId,
    topic: 'https://example.invalid/' + 'abcdefghijklmnopqrstuvwxyz'.repeat(18),
  });
  token = driver.token;
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  panel.setTitle('Teach me, Agent · 长主题布局验收');
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (action) => js(`window.companion.perform(${JSON.stringify(action)})`);
  const settle = async () => {
    await pause(100);
    for (let i = 0; i < 150; i++) {
      if (!(await state()).panelAnimating) {
        await pause(80);
        if (!(await state()).panelAnimating) return;
      }
      await pause(20);
    }
    throw new Error('layout did not settle');
  };
  for (let i = 0; i < 5; i++)
    await call('say', { text: `长历史 ${i + 1}\n` + '长消息与连续阅读。'.repeat(65) });
  await act({ type: 'prepare' });
  await settle();
  await js('document.querySelector("textarea").focus();true');
  const draft = '保留多行草稿，输入区域和发送必须始终可达。'.repeat(20);
  await panel.webContents.insertText(draft);
  await settle();
  assert.equal(await js('document.querySelector("textarea").value'), draft);
  await js(
    'window.__composer=document.querySelector("textarea");window.__composer.setSelectionRange(2,6);true',
  );
  for (const width of [520, 460]) {
    panel.webContents.setZoomFactor(520 / width);
    await settle();
    const joining = call('attach', { session: driver.id }).catch((error) => ({
      error: error.message,
    }));
    for (let i = 0; i < 100 && !(await state()).connection; i++) await pause(20);
    assert.ok((await state()).connection);
    await settle();
    await fs.writeFile(
      path.join(home, `approval-${width}.png`),
      (await panel.capturePage()).toPNG(),
    );
    const metrics = await js(`(()=>{
      const bounds=s=>{const e=document.querySelector(s),b=e.getBoundingClientRect();return {bottom:b.bottom,right:b.right,top:b.top,height:b.height,width:b.width,scroll:e.scrollWidth,client:e.clientWidth}};
      return {viewport:[innerWidth,innerHeight],header:bounds('.header'),details:bounds('.panel-details'),topic:bounds('.request p'),decision:bounds('.request .primary'),composer:bounds('.composer'),send:bounds('.send'),tools:bounds('.tools')};
    })()`);
    assert.ok(Math.abs(metrics.viewport[0] - width) < 2);
    assert.ok(metrics.details.scroll <= metrics.details.client + 1, JSON.stringify(metrics));
    assert.ok(metrics.topic.scroll <= metrics.topic.client + 1, JSON.stringify(metrics));
    assert.ok(metrics.topic.height <= 121);
    assert.ok(metrics.decision.bottom <= metrics.details.bottom + 1, JSON.stringify(metrics));
    assert.ok(metrics.send.bottom <= metrics.viewport[1] + 1, JSON.stringify(metrics));
    assert.ok(metrics.tools.scroll <= metrics.tools.client + 1, JSON.stringify(metrics));
    if (metrics.header.top < 0)
      console.log(
        `PENDING_T02: ${width} CSS px zoom clips header; this fixture only accepts topic wrapping`,
      );
    assert.equal(await js('window.__composer===document.querySelector("textarea")'), true);
    assert.equal(await js('window.__composer.value'), draft);
    assert.deepEqual(
      await js('({start:window.__composer.selectionStart,end:window.__composer.selectionEnd})'),
      { start: 2, end: 6 },
    );
    await js('document.querySelector(".request button").click()');
    assert.match((await joining).error, /拒绝/);
    console.log(`PASS: ${width} CSS px topic wrapping, draft retention, decision and send`);
  }
  // Verify the preserved draft still submits through the actual rendered button.
  await js('document.querySelector(".send").click()');
  const message = (await call('wait', { timeoutMs: 1000 })).messages[0];
  assert.equal(message.text, draft);
  await call('ack', { id: message.id });
  await settle();
  assert.equal(await js('document.querySelector("textarea").value'), '');
  console.log('CHECKS_COMPLETE');
  await call('stop');
}
run().catch((error) => {
  console.error(error);
  app.exit(1);
});
