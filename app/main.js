const { app, BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('../lib/paths');
const { Shots } = require('./shots');
const { Session } = require('./session');
const { WinHelper } = require('./win');
const { startServer } = require('./server');
const { resolveScene } = require('./scene');

const VERSION = require('../package.json').version;
const DEBUG = process.env.TMA_DEBUG === '1';
const PRELOAD = path.join(__dirname, 'preload.js');
const UI = path.join(__dirname, 'ui');
const PANEL_SIZE = { width: 380, height: 540 };

fs.mkdirSync(P.home, { recursive: true });

function log(msg) {
  try {
    fs.appendFileSync(P.logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

if (!app.requestSingleInstanceLock()) app.exit(0);

const config = P.loadConfig();
const win = new WinHelper(log);

const S = {
  token: crypto.randomBytes(24).toString('hex'),
  port: 0,
  session: null,
  shots: null,
  defaultShot: null,
  overlays: new Map(),
  panel: null,
  panelExpandedHeight: PANEL_SIZE.height,
  freeze: { win: null, busy: false, frame: null, prevHwnd: null },
  overlayHidden: false,
  scene: null,
  sceneSeq: 0,
  talk: { viaHotkey: false, displayId: null, prevHwnd: null },
  draft: '',
  history: [],
  hotkeyErrors: [],
  agentState: { name: null, since: Date.now() },
  quitting: false,
};

const HOTKEY_LABELS = { freeze: '圈给它看', talk: '跟它说', toggleOverlay: '隐藏/显示指引' };

// ---------- helpers ----------

function alive(w) {
  return w && !w.isDestroyed();
}

function panelSend(channel, data) {
  if (alive(S.panel)) S.panel.webContents.send(channel, data);
}

function notice(text) {
  const entry = { kind: 'notice', text, at: Date.now() };
  S.history.push(entry);
  panelSend('panel:notice', entry);
}

function protect(w) {
  if (!config.showInScreenCapture) w.setContentProtection(true);
}

function hwndOf(w) {
  const b = w.getNativeWindowHandle();
  return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
}

function isOurs(hwnd) {
  if (!hwnd) return false;
  const wins = [S.panel, S.freeze.win, ...[...S.overlays.values()].map((o) => o.win)];
  return wins.some((w) => alive(w) && hwndOf(w) === String(hwnd));
}

function cursorDisplay() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function publicShot(s) {
  return { id: s.id, role: s.role, note: s.note, path: s.path, width: s.width, height: s.height };
}

// ---------- session ----------

function sessionInfo() {
  const s = S.session;
  return { id: s.id, topic: s.topic, dir: s.dir, scratch: path.join(s.dir, 'scratch') };
}

function pushState() {
  if (!S.session) return;
  const name = S.session.agentState();
  if (name !== S.agentState.name) S.agentState = { name, since: Date.now() };
  panelSend('panel:state', { agent: name, since: S.agentState.since, pending: S.session.pending().length });
}

function newSession(topic) {
  if (S.session) S.session.close('replaced by a new session');
  let id = stamp();
  if (fs.existsSync(path.join(P.sessionsDir, id))) id += '-' + crypto.randomBytes(2).toString('hex');
  const dir = path.join(P.sessionsDir, id);
  S.session = new Session({ id, dir, topic });
  S.session.on('state', pushState);
  S.shots = new Shots({ dir: path.join(dir, 'shots'), config });
  fs.mkdirSync(path.join(dir, 'scratch'), { recursive: true });
  S.defaultShot = null;
  S.history = [];
  clearOverlays();
  panelSend('panel:session', { session: sessionInfo(), history: S.history });
  pushState();
  return S.session;
}

function say(text) {
  const entry = { kind: 'agent', text, at: Date.now() };
  S.history.push(entry);
  panelSend('panel:say', entry);
  if (alive(S.panel) && !S.panel.isVisible()) S.panel.showInactive();
  S.session.record({ from: 'agent', say: text });
  S.session.touch();
}

function deliver({ source, text, shots }) {
  const m = S.session.push({ kind: 'message', source, text: text || '', shots: shots.map(publicShot) });
  const entry = {
    kind: 'user',
    id: m.id,
    text: m.text,
    shots: m.shots.map((s) => ({ id: s.id, path: s.path, role: s.role })),
    at: Date.now(),
  };
  S.history.push(entry);
  panelSend('panel:user', entry);
  return m;
}

// ---------- overlay ----------

function createOverlay(display) {
  const b = display.bounds;
  const w = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  w.setIgnoreMouseEvents(true);
  w.setAlwaysOnTop(true, 'screen-saver');
  protect(w);
  const o = { win: w, display, hasContent: false };
  o.ready = new Promise((resolve) => w.webContents.once('did-finish-load', resolve));
  w.loadFile(path.join(UI, 'overlay.html'));
  S.overlays.set(display.id, o);
  return o;
}

function syncOverlays() {
  const displays = screen.getAllDisplays();
  for (const [id, o] of S.overlays) {
    if (!displays.some((d) => d.id === id)) {
      o.win.destroy();
      S.overlays.delete(id);
    }
  }
  for (const d of displays) {
    const o = S.overlays.get(d.id);
    if (!o) createOverlay(d);
    else {
      o.display = d;
      o.win.setBounds(d.bounds);
    }
  }
}

function showOverlay(o) {
  if (S.overlayHidden || !o.hasContent) return;
  o.win.setBounds(o.display.bounds);
  o.win.showInactive();
  o.win.setAlwaysOnTop(true, 'screen-saver');
  if (alive(S.panel) && S.panel.isVisible()) S.panel.moveTop();
}

function clearOverlays() {
  for (const o of S.overlays.values()) {
    o.hasContent = false;
    o.win.webContents.send('overlay:clear');
    o.win.hide();
  }
  S.scene = null;
}

async function toggleOverlay() {
  S.overlayHidden = !S.overlayHidden;
  for (const o of S.overlays.values()) {
    if (S.overlayHidden) o.win.hide();
    else showOverlay(o);
  }
  panelSend('panel:overlay-hidden', S.overlayHidden);
}

async function showScene(scene) {
  const displays = screen.getAllDisplays();
  const { items, warnings, shots } = resolveScene(scene, {
    shots: S.shots,
    defaultShot: S.defaultShot,
    displays,
    primary: screen.getPrimaryDisplay(),
  });
  const replace = Array.isArray(scene.items) && !scene.keep;
  const id = ++S.sceneSeq;
  const byDisplay = new Map();
  for (const it of items) {
    if (!byDisplay.has(it.display)) byDisplay.set(it.display, []);
    byDisplay.get(it.display).push(it);
  }
  for (const o of S.overlays.values()) {
    const list = byDisplay.get(o.display.id) || [];
    if (list.length) {
      await o.ready;
      o.win.webContents.send('overlay:scene', { id, items: list, keep: !replace });
      o.hasContent = true;
      showOverlay(o);
    } else if (replace) {
      o.win.webContents.send('overlay:clear');
      o.hasContent = false;
      o.win.hide();
    }
  }
  if (items.length) {
    const prev = !replace && S.scene ? S.scene.types : [];
    S.scene = { id, types: [...prev, ...items.map((i) => i.type)], shots, at: Date.now() };
  } else if (replace) S.scene = null;
  if (scene.say) say(String(scene.say));
  S.session.touch();
  S.session.record({ from: 'agent', scene });
  return { id, drawn: items.map((i) => i.type), shots, warnings, overlayHidden: S.overlayHidden };
}

// ---------- panel ----------

function createPanel() {
  const wa = screen.getPrimaryDisplay().workArea;
  const p = new BrowserWindow({
    ...PANEL_SIZE,
    x: wa.x + wa.width - PANEL_SIZE.width - 16,
    y: wa.y + wa.height - PANEL_SIZE.height - 16,
    minWidth: 300,
    minHeight: 120,
    frame: false,
    show: false,
    alwaysOnTop: true,
    fullscreenable: false,
    maximizable: false,
    backgroundColor: '#14161b',
    title: 'Teach me, Agent',
    webPreferences: { preload: PRELOAD },
  });
  p.setAlwaysOnTop(true, 'screen-saver');
  protect(p);
  p.loadFile(path.join(UI, 'panel.html'));
  p.once('ready-to-show', () => p.showInactive());
  p.webContents.on('did-finish-load', () => {
    panelSend('panel:init', {
      session: sessionInfo(),
      history: S.history,
      hotkeys: config.hotkeys,
      hotkeyErrors: S.hotkeyErrors,
      overlayHidden: S.overlayHidden,
      debug: DEBUG,
    });
    pushState();
  });
  p.on('blur', () => {
    S.talk.viaHotkey = false;
  });
  p.on('close', (e) => {
    if (S.quitting) return;
    e.preventDefault();
    quit('the user closed the panel');
  });
  S.panel = p;
}

async function talk() {
  S.talk.displayId = cursorDisplay().id;
  const prev = await win.foreground();
  S.talk.prevHwnd = prev && !isOurs(prev) ? prev : null;
  S.talk.viaHotkey = true;
  if (S.panel.isMinimized()) S.panel.restore();
  S.panel.show();
  S.panel.focus();
  S.panel.moveTop();
  panelSend('panel:focus-input');
}

async function glance(display) {
  const frame = await S.shots.grab(display);
  return S.shots.fromFrame(frame, null, 'glance', 'the whole screen at the moment the user hit send');
}

ipcMain.handle('panel:send', async (_e, { text, attach }) => {
  text = String(text || '').trim();
  if (!text) return { ok: false };
  const viaHotkey = S.talk.viaHotkey;
  const shots = [];
  if (attach) {
    try {
      const d = (viaHotkey && screen.getAllDisplays().find((x) => x.id === S.talk.displayId)) || cursorDisplay();
      shots.push(await glance(d));
    } catch (e) {
      log('glance failed: ' + e.stack);
      notice('截屏失败：' + e.message);
    }
  }
  deliver({ source: 'panel', text, shots });
  S.draft = '';
  if (viaHotkey) {
    S.talk.viaHotkey = false;
    const h = S.talk.prevHwnd;
    S.talk.prevHwnd = null;
    if (h) win.activate(h);
  }
  return { ok: true };
});

ipcMain.on('panel:draft', (_e, text) => {
  S.draft = String(text || '');
});
ipcMain.on('panel:escape', () => {
  const h = S.talk.prevHwnd;
  S.talk.viaHotkey = false;
  S.talk.prevHwnd = null;
  if (h) win.activate(h);
});
ipcMain.on('panel:freeze', () => startFreeze());
ipcMain.on('panel:clear-overlay', () => {
  clearOverlays();
  S.session.record({ from: 'user', cleared: true });
});
ipcMain.on('panel:toggle-overlay', () => toggleOverlay());
ipcMain.on('panel:end', () => {
  if (S.session.ended) return;
  S.session.end();
  clearOverlays();
});
ipcMain.on('panel:quit', () => quit('the user closed the panel'));
ipcMain.on('panel:minimize', () => S.panel.minimize());
ipcMain.on('panel:collapse', (_e, { collapsed, height }) => {
  const b = S.panel.getBounds();
  const wa = screen.getDisplayMatching(b).workArea;
  if (collapsed) {
    S.panelExpandedHeight = b.height;
    const h = Math.max(96, Math.round(height || 132));
    S.panel.setMinimumSize(300, h);
    S.panel.setBounds({ x: b.x, y: b.y + b.height - h, width: b.width, height: h });
  } else {
    const h = S.panelExpandedHeight || PANEL_SIZE.height;
    S.panel.setMinimumSize(300, 120);
    S.panel.setBounds({ x: b.x, y: Math.max(wa.y, b.y + b.height - h), width: b.width, height: h });
  }
});
ipcMain.on('voice:dictate', () => win.dictate());

// ---------- freeze (circle-to-ask) ----------

function createFreeze() {
  const fw = new BrowserWindow({
    title: 'Teach me, Agent',
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: '#000000',
    enableLargerThanScreen: true,
    webPreferences: { preload: PRELOAD, backgroundThrottling: false },
  });
  fw.setAlwaysOnTop(true, 'screen-saver');
  protect(fw);
  fw.loadFile(path.join(UI, 'freeze.html'));
  fw.on('close', (e) => {
    if (S.quitting) return;
    e.preventDefault();
    endFreeze(true);
  });
  S.freeze.win = fw;
}

async function startFreeze() {
  if (S.freeze.busy) return;
  S.freeze.busy = true;
  try {
    const prev = await win.foreground();
    S.freeze.prevHwnd = prev && !isOurs(prev) ? prev : null;
    const display = cursorDisplay();
    const frame = await S.shots.grab(display);
    S.freeze.frame = frame;
    const fw = S.freeze.win;
    fw.setBounds(display.bounds);
    fw.setBounds(display.bounds);
    const size = frame.image.getSize();
    const ready = new Promise((resolve) => {
      const done = () => {
        clearTimeout(t);
        ipcMain.removeListener('freeze:ready', done);
        resolve();
      };
      const t = setTimeout(done, 4000);
      ipcMain.on('freeze:ready', done);
    });
    fw.webContents.send('freeze:start', {
      bitmap: frame.image.toBitmap(),
      width: size.width,
      height: size.height,
      draft: S.draft,
    });
    await ready;
    fw.setOpacity(0);
    fw.show();
    fw.setAlwaysOnTop(true, 'screen-saver');
    fw.moveTop();
    fw.focus();
    setTimeout(() => alive(fw) && fw.setOpacity(1), 60);
  } catch (e) {
    S.freeze.busy = false;
    S.freeze.frame = null;
    log('freeze failed: ' + e.stack);
    notice('定格画面失败：' + e.message);
  }
}

function endFreeze(restoreFocus) {
  const fw = S.freeze.win;
  if (alive(fw)) {
    fw.hide();
    fw.webContents.send('freeze:reset');
  }
  S.freeze.busy = false;
  S.freeze.frame = null;
  const h = S.freeze.prevHwnd;
  S.freeze.prevHwnd = null;
  if (restoreFocus && h) win.activate(h);
}

ipcMain.handle('freeze:submit', async (_e, { selection, png, text, strokes }) => {
  const frame = S.freeze.frame;
  if (!frame) return { ok: false, error: 'nothing is frozen' };
  try {
    const b = frame.display.bounds;
    const sel = { x: b.x + selection.x, y: b.y + selection.y, width: selection.width, height: selection.height };
    const whole = selection.width >= b.width - 4 && selection.height >= b.height - 4;
    const shots = [];
    shots.push(
      S.shots.fromPng(
        png,
        frame,
        sel,
        strokes ? 'annotated' : 'selection',
        strokes ? 'the region the user circled, with their red pen marks' : 'the region the user circled',
      ),
    );
    if (!whole) {
      const ctx = S.shots.fromFrame(frame, null, 'context', '');
      const a = S.shots.toShot(ctx, sel.x, sel.y);
      const z = S.shots.toShot(ctx, sel.x + sel.width, sel.y + sel.height);
      const r = [a.x, a.y, z.x - a.x, z.y - a.y].map(Math.round);
      ctx.note = `the whole screen, clean; the circled region is at [${r.join(',')}] in this image`;
      shots.push(ctx);
    } else if (strokes) {
      shots.push(S.shots.fromFrame(frame, null, 'clean', 'the same screen without the pen marks'));
    }
    endFreeze(true);
    deliver({ source: 'freeze', text, shots });
    S.draft = '';
    panelSend('panel:clear-draft');
    return { ok: true };
  } catch (e) {
    log('freeze submit failed: ' + e.stack);
    endFreeze(true);
    notice('发送失败：' + e.message);
    return { ok: false, error: e.message };
  }
});
ipcMain.on('freeze:cancel', () => endFreeze(true));

// ---------- hotkeys ----------

const HOTKEY_ACTIONS = { freeze: startFreeze, talk, toggleOverlay };

function registerHotkeys() {
  S.hotkeyErrors = [];
  for (const [name, fn] of Object.entries(HOTKEY_ACTIONS)) {
    const acc = config.hotkeys[name];
    if (!acc) continue;
    let ok = false;
    try {
      ok = globalShortcut.register(acc, () => {
        Promise.resolve(fn()).catch((e) => log(`hotkey ${name} failed: ${e.stack}`));
      });
    } catch (e) {
      log(`hotkey ${acc} invalid: ${e.message}`);
    }
    if (!ok) S.hotkeyErrors.push(`${acc}（${HOTKEY_LABELS[name]}）注册失败，可能被别的程序占用；可在 ${P.configFile} 里改`);
  }
}

// ---------- HTTP routes for the CLI ----------

function debugTarget(name) {
  if (name === 'panel') return S.panel;
  if (name === 'freeze') return S.freeze.win;
  if (name && name.startsWith('overlay')) {
    const id = name.split(':')[1];
    const o = id ? S.overlays.get(Number(id)) : S.overlays.get(screen.getPrimaryDisplay().id);
    return o && o.win;
  }
  throw new Error('unknown debug target ' + name);
}

const routes = {
  'GET /health': () => ({ ok: true, pid: process.pid, version: VERSION, session: sessionInfo() }),

  'POST /session': ({ body }) => {
    const topic = body.topic ? String(body.topic) : '';
    const pristine = !S.session.messages.length && !S.session.ended && !S.shots.shots.size;
    if (pristine) {
      S.session.topic = topic;
      panelSend('panel:session', { session: sessionInfo(), history: S.history });
    } else newSession(topic);
    S.session.touch();
    if (body.say) say(String(body.say));
    if (alive(S.panel) && !S.panel.isVisible()) S.panel.showInactive();
    return { session: sessionInfo(), hotkeys: config.hotkeys, hotkeyErrors: S.hotkeyErrors };
  },

  'GET /wait': async ({ query, onAbort }) => {
    const seconds = Math.min(3600, Math.max(1, Number(query.get('timeout')) || 480));
    const session = S.session;
    const r = await session.wait(seconds * 1000, onAbort);
    if (r.messages) {
      const withShot = [...r.messages].reverse().find((m) => m.shots && m.shots.length);
      if (withShot) S.defaultShot = withShot.shots[0].id;
    }
    return { ...r, session: session.id, defaultShot: S.defaultShot, scene: S.scene, overlayHidden: S.overlayHidden };
  },

  'POST /ack': ({ body }) => {
    S.session.ack(Number(body.id) || 0);
    return { ok: true };
  },

  'POST /say': ({ body }) => {
    if (!body.text) throw new Error('say needs text');
    say(String(body.text));
    return { ok: true };
  },

  'POST /show': ({ body }) => showScene(body.scene || body),

  'POST /clear': () => {
    clearOverlays();
    S.session.touch();
    return { ok: true };
  },

  'POST /zoom': ({ body }) => {
    if (!Array.isArray(body.rect) || body.rect.length < 4) throw new Error('zoom needs rect [x,y,w,h]');
    return { shot: publicShot(S.shots.zoom(body.shot, body.rect.map(Number))) };
  },

  'GET /status': () => ({
    version: VERSION,
    session: sessionInfo(),
    agent: S.session.agentState(),
    pending: S.session.pending().length,
    defaultShot: S.defaultShot,
    scene: S.scene,
    overlayHidden: S.overlayHidden,
    hotkeys: config.hotkeys,
    hotkeyErrors: S.hotkeyErrors,
    recentShots: [...S.shots.shots.values()].slice(-6).map(publicShot),
    primaryDisplay: screen.getPrimaryDisplay().id,
    displays: screen.getAllDisplays().map((d) => ({ id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor })),
  }),

  'POST /stop': () => {
    setTimeout(() => quit('stopped by the agent'), 150);
    return { ok: true };
  },
};

if (DEBUG) {
  routes['POST /debug/eval'] = ({ body }) => debugTarget(body.target).webContents.executeJavaScript(String(body.js));
  routes['POST /debug/hotkey'] = async ({ body }) => {
    await HOTKEY_ACTIONS[body.name]();
    return { ok: true };
  };
  routes['POST /debug/capture'] = async ({ body }) => {
    const img = await debugTarget(body.target).webContents.capturePage();
    const file = path.join(S.session.dir, `debug-${body.target.replace(':', '_')}-${Date.now()}.png`);
    fs.writeFileSync(file, img.toPNG());
    return { path: file, size: img.getSize() };
  };
  routes['POST /debug/input'] = async ({ body }) => {
    const w = debugTarget(body.target);
    for (const ev of body.events || []) {
      if (ev.wait) await new Promise((r) => setTimeout(r, ev.wait));
      else w.webContents.sendInputEvent(ev);
    }
    return { ok: true };
  };
}

// ---------- lifecycle ----------

function pruneSessions(days) {
  if (!days || !fs.existsSync(P.sessionsDir)) return;
  const cutoff = Date.now() - days * 86400000;
  for (const name of fs.readdirSync(P.sessionsDir)) {
    const dir = path.join(P.sessionsDir, name);
    try {
      if (fs.statSync(dir).mtimeMs < cutoff) fs.rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
}

function writeState() {
  fs.writeFileSync(
    P.stateFile,
    JSON.stringify({ pid: process.pid, port: S.port, token: S.token, version: VERSION, startedAt: Date.now() }),
  );
}

function removeState() {
  try {
    const st = P.readState();
    if (st && st.pid === process.pid) fs.unlinkSync(P.stateFile);
  } catch {}
}

function quit(reason) {
  if (S.quitting) return;
  S.quitting = true;
  log('quitting: ' + reason);
  if (S.session) S.session.close(reason);
  removeState();
  setTimeout(() => app.quit(), 250);
}

app.on('second-instance', () => {
  if (alive(S.panel)) S.panel.showInactive();
});

app.on('window-all-closed', () => {});

app.on('will-quit', () => {
  S.quitting = true;
  globalShortcut.unregisterAll();
  win.dispose();
  removeState();
});

app.whenReady().then(async () => {
  try {
    pruneSessions(Number(config.keepSessionsDays) || 0);
    newSession(process.env.TMA_TOPIC || '');
    syncOverlays();
    createFreeze();
    registerHotkeys();
    createPanel();
    win.warm();
    const { port } = await startServer({ token: S.token, routes, log });
    S.port = port;
    writeState();
    for (const ev of ['display-added', 'display-removed', 'display-metrics-changed']) screen.on(ev, syncOverlays);
    setInterval(pushState, 5000);
    log(`ready on port ${port}`);
  } catch (e) {
    log('startup failed: ' + e.stack);
    app.exit(1);
  }
});
