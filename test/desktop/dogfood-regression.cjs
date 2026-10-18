const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
module.exports = async ({ panel, call, start, home, copied }) => {
  const checks = [];
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const js = (code) => panel.webContents.executeJavaScript(code);
  const state = () => js('window.companion.snapshot()');
  const act = (a) => js(`window.companion.perform(${JSON.stringify(a)})`);
  const settle = async () => {
    for (let i = 0; i < 100 && (await state()).panelAnimating; i++) await pause(20);
    await pause(100);
  };
  const screenshot = async (name) =>
    fs.writeFile(path.join(home, name + '.png'), (await panel.capturePage()).toPNG());
  try {
    await pause(120);
    await act({ type: 'prepare' });
    await settle();
    assert.equal((await state()).panelMode, 'conversation');
    assert.equal((await state()).error, null);
    assert.match(await js('document.body.innerText'), /先连接你的 Agent/);
    await js('document.querySelector(".connect-help").click()');
    await pause(60);
    assert.match(copied(), /teach-me\.mjs.*start/);
    assert.ok(!copied().includes('token'));
    assert.match(await js('document.querySelector(".connect-help").textContent'), /已复制/);
    await screenshot('connection-help');
    checks.push(
      'disconnected input opens connection help without an error; fixed copy instructions contain no credentials',
    );
    await start();
    for (let i = 0; i < 5; i++)
      await call('say', { text: `步骤 ${i + 1}\n` + '回看步骤时不应丢失阅读位置。'.repeat(25) });
    await settle();
    await js(
      `window.__composer=document.querySelector('textarea');const t=document.querySelector('.thread');t.scrollTop=100;t.dispatchEvent(new Event('scroll'));true`,
    );
    await pause(80);
    const before = await js('document.querySelector(".thread").scrollTop');
    await call('say', { text: '这是新到达的回复。' });
    await pause(120);
    assert.ok(Math.abs((await js('document.querySelector(".thread").scrollTop')) - before) < 3);
    assert.match(await js('document.querySelector(".new-messages").textContent'), /1 条新回复/);
    await screenshot('reading-position');
    await js(`document.querySelector('button[aria-label="设置"]').click()`);
    await pause(100);
    assert.ok(await js('!!document.querySelector(".settings-view")'));
    await call('say', { text: '设置中到达的回复也应保留阅读位置。' });
    await js(`document.querySelector('button[aria-label="设置"]').click()`);
    await pause(100);
    assert.ok(Math.abs((await js('document.querySelector(".thread").scrollTop')) - before) < 3);
    assert.match(await js('document.querySelector(".new-messages").textContent'), /2 条新回复/);
    await js('document.querySelector(".new-messages").click()');
    await pause(80);
    assert.equal(await js('!!document.querySelector(".new-messages")'), false);
    assert.ok(
      await js(
        `(()=>{const t=document.querySelector('.thread');return t.scrollHeight-t.clientHeight-t.scrollTop<32})()`,
      ),
    );
    await call('say', { text: '回到底部后继续跟随这一条消息。' });
    await pause(100);
    assert.ok(
      await js(
        `(()=>{const t=document.querySelector('.thread');return t.scrollHeight-t.clientHeight-t.scrollTop<32})()`,
      ),
    );
    checks.push(
      'new replies and returning from settings preserve reading position; jump badge returns to live following',
    );
    await act({ type: 'prepare' });
    await settle();
    const draft = '我需要补充一段较长的反馈，输入区和发送按钮应始终可见。'.repeat(18);
    await panel.webContents.insertText(draft);
    await pause(120);
    const fits = await js(
      `(()=>{const c=document.querySelector('.composer').getBoundingClientRect();const s=document.querySelector('.send').getBoundingClientRect();const t=document.querySelector('.thread');return {composer:c.bottom,send:s.bottom,height:innerHeight,thread:t.clientHeight,outer:document.documentElement.scrollTop}})()`,
    );
    assert.ok(fits.composer <= fits.height + 1, JSON.stringify(fits));
    assert.ok(fits.send <= fits.height + 1, JSON.stringify(fits));
    assert.ok(fits.thread > 80, JSON.stringify(fits));
    assert.equal(fits.outer, 0);
    assert.equal(await js('window.__composer===document.querySelector("textarea")'), true);
    await screenshot('long-draft');
    await js('document.querySelector(".send").click()');
    await pause(120);
    const message = (await call('wait', { timeoutMs: 1000 })).messages[0];
    assert.equal(message.text, draft);
    await call('ack', { id: message.id });
    assert.equal(await js('window.__composer.value'), '');
    checks.push(
      'long history plus maximum-height draft keeps the composer and send visible, with no outer-page scroll; submit still delivers and clears',
    );
    await fs.writeFile(path.join(home, 'result.json'), JSON.stringify({ passed: true, checks }));
    console.log(JSON.stringify({ passed: true, checks }));
  } catch (e) {
    await fs.writeFile(
      path.join(home, 'result.json'),
      JSON.stringify({ passed: false, error: e.message, checks }),
    );
    throw e;
  }
};
