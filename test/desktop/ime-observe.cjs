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
  for (let n = 0; n < 150; n++) {
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
    const r = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-companion-token': endpoint.token,
        'x-session-token': token,
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
    const result = await r.json();
    if (!r.ok) throw new Error(result.error);
    return result;
  };
  token = (
    await call('start', {
      launchSecret: 'ime-fixture',
      displayId: (await call('status')).displayId,
      topic: 'IME组合输入验收',
    })
  ).token;
  const panel = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes('mode=panel'),
  );
  panel.setTitle('Teach me, Agent · IME验收');
  const js = (source) => panel.webContents.executeJavaScript(source);
  await js(`window.__imeEvents=[];
    for(const type of ['compositionstart','compositionupdate','compositionend','keydown','input']){
      document.querySelector('textarea').addEventListener(type,e=>{
        window.__imeEvents.push({type,key:e.key||'',composing:!!e.isComposing,inputType:e.inputType||''});
        if(window.__imeEvents.length>200)window.__imeEvents.shift();
      });
    }`);
  await js('window.companion.perform({type:"prepare"})');
  console.log(
    'READY: native IME only; send 你好\\n你好, then confirm nihao with Enter before sending.',
  );
  let replied = false;
  let lastCount = 0;
  while (true) {
    const observation = await js(`window.companion.snapshot().then(s=>({
      events:window.__imeEvents,draft:document.querySelector('textarea').value,
      messages:s.messages.filter(m=>m.role==='user').map(m=>({id:m.id,text:m.text})),
      mode:s.panelMode,turn:s.input.turnId,phase:s.input.phase,
      focus:document.activeElement===document.querySelector('textarea')
    }))`);
    await fs.writeFile(path.join(home, 'observation.json'), JSON.stringify(observation, null, 2));
    if (!replied && observation.events.some((e) => e.type === 'compositionstart')) {
      replied = true;
      await call('say', { text: '组合输入期间到达的回复，不应重排输入。' });
    }
    if (observation.messages.length !== lastCount) {
      lastCount = observation.messages.length;
      console.log(`OBSERVED: ${lastCount} message(s)`);
    }
    if (lastCount >= 2) {
      assert.deepEqual(
        observation.messages.map((m) => m.text),
        ['你好\n你好', 'nihao'],
      );
      assert.ok(observation.events.some((e) => e.type === 'compositionstart'));
      assert.ok(observation.events.some((e) => e.type === 'compositionend'));
      assert.ok(
        observation.events.some(
          (e) => e.type === 'keydown' && ['Process', 'Enter'].includes(e.key) && e.composing,
        ),
      );
      const delivered = await call('wait', { timeoutMs: 1000 });
      assert.equal(delivered.messages.length, 2);
      await call('ack', { id: delivered.messages.at(-1).id });
      console.log('CHECKS_COMPLETE: native composition, multiline, Enter and two queued messages');
      await call('stop');
      return;
    }
    await pause(100);
  }
}
run().catch((e) => {
  console.error(e);
  app.exit(1);
});
