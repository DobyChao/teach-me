const { app, BrowserWindow, globalShortcut, clipboard } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
globalShortcut.register = () => true;
let copied = '';
if (process.argv.includes('--verify'))
  clipboard.writeText = (text) => {
    copied = text;
  };
require('../../dist/host/main.cjs');
const home = process.env.TEACH_ME_AGENT_HOME;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
app
  .whenReady()
  .then(async () => {
    let endpoint;
    for (let i = 0; i < 100; i++) {
      try {
        endpoint = JSON.parse(await fs.readFile(path.join(home, 'endpoint.json'), 'utf8'));
        break;
      } catch {
        await pause(100);
      }
    }
    let driver;
    const call = async (route, data = {}) => {
      const r = await fetch(`http://127.0.0.1:${endpoint.port}/${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-companion-token': endpoint.token,
          ...(driver ? { 'x-session-token': driver.token } : {}),
        },
        body: JSON.stringify(data),
      });
      if (!r.ok) throw Error((await r.json()).error);
      return r.json();
    };
    const status = await call('status');
    const start = async () => {
      driver = await call('start', {
        launchSecret: 'dogfood-test',
        topic: '日常使用体验检查',
        displayId: status.displayId,
      });
    };
    const panel = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('mode=panel'),
    );
    if (process.argv.includes('--verify')) {
      await require('./dogfood-regression.cjs')({ panel, call, start, home, copied: () => copied });
      await call('stop');
      return;
    }
    await start();
    await fs.mkdir(path.join(home, 'clients'), { recursive: true });
    await fs.writeFile(
      path.join(home, 'clients', createHash('sha256').update('dogfood').digest('hex') + '.json'),
      JSON.stringify(driver),
    );
    let busy = false;
    const nativeFrames = [];
    const framesTimer = setInterval(() => {
      if (!panel.isDestroyed()) nativeFrames.push({ at: Date.now(), ...panel.getBounds() });
      if (nativeFrames.length > 180) nativeFrames.shift();
    }, 16);
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const ui = await panel.webContents.executeJavaScript(
          `(()=>{const s=window.companion.snapshot();const rect=selector=>{const e=document.querySelector(selector);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom,scroll:e.scrollHeight,client:e.clientHeight,top:e.scrollTop}};return s.then(state=>({mode:state.panelMode,input:state.input.phase,voice:state.voice.phase,board:state.userBoard,editing:state.editing,focused:document.activeElement?.tagName,textarea:rect('textarea'),composer:rect('.composer'),thread:rect('.thread'),panel:rect('.panel'),settings:state.settingsOpen,innerHeight}))})()`,
        );
        await fs.writeFile(
          path.join(home, 'observation.json'),
          JSON.stringify({
            bounds: panel.getBounds(),
            hwnd: panel.getNativeWindowHandle().toString('hex'),
            ...ui,
            settingsWindow: BrowserWindow.getAllWindows()
              .filter((w) => w.webContents.getURL().includes('mode=settings'))
              .map((w) => ({ visible: w.isVisible(), bounds: w.getBounds() })),
          }),
        );
        if (new Set(nativeFrames.map((f) => `${f.width},${f.height}`)).size > 3)
          await fs.writeFile(
            path.join(home, 'native-transitions.json'),
            JSON.stringify(nativeFrames),
          );
      } catch {
      } finally {
        busy = false;
      }
    }, 400);
    app.once('will-quit', () => {
      clearInterval(timer);
      clearInterval(framesTimer);
    });
    console.log('Isolated dogfood app ready; CLI client: dogfood.');
  })
  .catch((e) => {
    console.error(e.message);
    app.exit(1);
  });
