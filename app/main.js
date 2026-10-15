const { app, BrowserWindow, screen, globalShortcut, ipcMain, clipboard } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const P = require('../lib/paths');
const { Shots } = require('./shots');
const { Session } = require('./session');
const { WinHelper } = require('./win');
const { startServer } = require('./server');
const { resolveScene } = require('./scene');
const { Board } = require('./board');
const { createTour } = require('./tour');
const { createHtmlHost } = require('./html-window');
const { decideStart, decideAttach } = require('../lib/session-gate');
const {
  beginCapture,
  hotkeyOnCapture,
  applyCaptureDecision,
  lightweightContext,
  withoutCaptureContext,
  withRetries,
  MAX_ATTEMPTS,
} = require('../lib/capture-policy');
const { layoutChanged, STALE_PROMPT } = require('../lib/coords');
const { inspectDisplay } = require('../lib/displays');
const { expandScene } = require('../lib/patterns');
const { assertSay, singleScene } = require('../lib/show-rules');
const { createGesture, resolveHold, acceleratorVks, HOLD_MS } = require('../lib/gesture');

const VERSION = require('../package.json').version;
const DEBUG = process.env.TMA_DEBUG === '1';
const PRELOAD = path.join(__dirname, 'preload.js');
const UI = path.join(__dirname, 'ui');
const ENGINES = new Set(['system', 'local', 'custom']);
const TIERS = new Set(['ask', 'lesson', 'always']);
const TTS = new Set(['off', 'follow']);
const MODES = new Set(['capsule', 'pet']);

fs.mkdirSync(P.home, { recursive: true });

function log(msg) {
  try {
    fs.appendFileSync(P.logFile, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!app.requestSingleInstanceLock()) app.exit(0);

let config = P.loadConfig();
const win = new WinHelper(log);
const board = new Board();
const pointerGesture = createGesture();

const S = {
  token: crypto.randomBytes(24).toString('hex'),
  port: 0,
  launchSecret: process.env.TMA_LAUNCH_SECRET || '',
  // One-shot free consent for the process that launched the app. Armed only
  // when that launch presents its secret, then cleared in handleStart.
  launchOk: false,
  session: null,
  shots: null,
  defaultShot: null,
  overlays: new Map(),
  panel: null,
  panelCollapsed: true,
  panelHover: false,
  panelAnchorBottom: 0,
  inputWin: null,
  settingsWin: null,
  gateWin: null,
  approvalWin: null,
  lessonDisplayId: null,
  lessonGeometry: null,
  layoutStale: false,
  probes: new Map(),
  overlayHidden: false,
  scene: null,
  sceneSeq: 0,
  editing: false,
  editHwnd: null,
  history: [],
  hotkeyErrors: [],
  agentState: { name: null, since: Date.now() },
  quitting: false,
  startInProgress: false,
  input: { open: false, frame: null, prev: null },
  voice: {
    gen: 0,
    open: false,
    stopping: false,
    listening: false,
    frame: null,
    prev: null,
    stash: null,
    timer: null,
    resultTimer: null,
    attachBoard: false,
    pending: null,
  },
  pointerTimer: null,
  inputLock: false,
  collapseTimer: null,
  gate: { pending: null, timer: null },
  capture: { wait: null, timer: null },
  hideDepth: 0,
  tour: null,
};

const htmlHost = createHtmlHost({
  log,
  onCrash() {
    notice('自定义指引已关闭，不会自动恢复。');
    if (S.scene) S.scene.html = false;
  },
});

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
  if (!config.showInScreenCapture && alive(w)) {
    try {
      w.setContentProtection(true);
    } catch {}
  }
}

function hwndOf(w) {
  const b = w.getNativeWindowHandle();
  return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString();
}

function isOurs(hwnd) {
  if (!hwnd) return false;
  return BrowserWindow.getAllWindows().some((w) => alive(w) && hwndOf(w) === String(hwnd));
}

function httpError(message, status, extra) {
  return Object.assign(new Error(message), { status }, extra);
}

function publicConfig() {
  return {
    hotkeys: config.hotkeys,
    attachScreenshot: config.attachScreenshot !== false,
    voice: config.voice,
    capture: config.capture,
    appearance: config.appearance,
  };
}

function publicSession() {
  if (!S.session) return null;
  return {
    id: S.session.id,
    topic: S.session.topic || '',
    dir: S.session.dir,
    scratch: path.join(S.session.dir, 'scratch'),
    displayId: S.lessonDisplayId,
    connected: !!S.session.connected,
  };
}

function publicShot(s) {
  return { id: s.id, role: s.role, note: s.note, path: s.path, width: s.width, height: s.height };
}

function isActive() {
  return !!(S.session && S.session.connected && !S.session.ended);
}

function presentedToken(headers) {
  return headers ? headers['x-tma-session'] : '';
}

function holdsConnection(headers) {
  const token = presentedToken(headers);
  return !!(token && S.session && S.session.connected && token === S.session.token);
}

function requireDriver(headers) {
  if (!isActive()) throw httpError('no active session', 409, { reason: 'no-session' });
  if (!holdsConnection(headers)) throw httpError('session token rejected', 401, { reason: 'token' });
}

function targetDisplay() {
  const all = screen.getAllDisplays();
  if (S.lessonDisplayId) return all.find((d) => d.id === S.lessonDisplayId) || screen.getPrimaryDisplay();
  return screen.getPrimaryDisplay();
}

function activeId() {
  return S.lessonDisplayId || screen.getPrimaryDisplay().id;
}

function workArea() {
  const d = targetDisplay();
  return d.workArea || d.bounds;
}

function panelSize() {
  const pet = config.appearance.mode === 'pet';
  if (S.panelCollapsed) return pet ? { width: 460, height: 148 } : { width: 520, height: 118 };
  return { width: pet ? 460 : 520, height: 560 };
}

function applyPanelBounds() {
  if (!alive(S.panel)) return;
  const size = panelSize();
  const area = workArea();
  const bottom = S.panelAnchorBottom || area.y + area.height - 16;
  const y = Math.max(area.y + 8, Math.min(bottom, area.y + area.height - 8) - size.height);
  const x = Math.max(area.x + 8, area.x + area.width - size.width - 16);
  S.panel.setBounds({ x, y, width: size.width, height: size.height });
  S.panelAnchorBottom = y + size.height;
}

function setCollapsed(collapsed) {
  S.panelCollapsed = !!collapsed;
  applyPanelBounds();
  panelSend('panel:collapsed', S.panelCollapsed);
}

function armAutoCollapse() {
  if (S.collapseTimer) clearTimeout(S.collapseTimer);
  const sec = Number(config.appearance.autoCollapseSec) || 0;
  if (sec <= 0 || S.panelHover || (S.tour && S.tour.running) || S.panelCollapsed) return;
  S.collapseTimer = setTimeout(() => {
    if (!S.panelHover && !(S.tour && S.tour.running)) setCollapsed(true);
  }, sec * 1000);
}

function expandForSay() {
  setCollapsed(false);
  armAutoCollapse();
}

function pushState() {
  if (!S.session) {
    panelSend('panel:state', { agent: 'offline', since: S.agentState.since, pending: 0 });
    return;
  }
  const name = S.session.agentState();
  if (name !== S.agentState.name) S.agentState = { name, since: Date.now() };
  panelSend('panel:state', { agent: name, since: S.agentState.since, pending: S.session.pending().length });
}

function syncBoard() {
  const snap = board.snapshot();
  const active = activeId();
  for (const [id, o] of S.overlays) {
    if (!alive(o.win)) continue;
    o.win.webContents.send('overlay:board', {
      user: snap.user.filter((s) => s.display == null || s.display === id),
      agent: snap.agent.filter((s) => s.display == null || s.display === id),
    });
    if (id === active) showOverlay(o);
  }
  panelSend('panel:board', snap);
}

function ensureSession(topic) {
  if (S.session && !S.session.ended) {
    if (topic) S.session.topic = topic;
    return S.session;
  }
  if (S.session) S.session.close('replaced');
  const id = crypto.randomUUID();
  const dir = path.join(P.sessionsDir, id);
  S.session = new Session({ id, dir, topic: topic || '' });
  S.session.connected = false;
  S.session.token = null;
  S.session.on('state', pushState);
  S.shots = new Shots({ dir: path.join(dir, 'shots'), config });
  fs.mkdirSync(path.join(dir, 'scratch'), { recursive: true });
  S.defaultShot = null;
  S.history = [];
  board.clearAll();
  S.scene = null;
  htmlHost.destroy();
  panelSend('panel:session', { session: publicSession(), history: S.history });
  pushState();
  writeState();
  return S.session;
}

function say(text) {
  ensureSession('');
  const entry = { kind: 'agent', text: String(text), at: Date.now() };
  S.history.push(entry);
  panelSend('panel:say', entry);
  expandForSay();
  if (alive(S.panel) && !S.panel.isVisible()) S.panel.showInactive();
  if (config.voice.tts === 'follow') panelSend('panel:speak', { text: entry.text });
  S.session.record({ from: 'agent', say: entry.text });
  S.session.touch();
}

function deliver({ source, text, shots }) {
  ensureSession('');
  const m = S.session.push({ kind: 'message', source, text: text || '', shots: (shots || []).map(publicShot) });
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

function chromeWindow(opts) {
  const w = new BrowserWindow({
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#16130f',
    autoHideMenuBar: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
    },
    ...opts,
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  protect(w);
  return w;
}

function createPanel() {
  const area = screen.getPrimaryDisplay().workArea;
  const size = panelSize();
  const p = chromeWindow({
    ...size,
    x: area.x + area.width - size.width - 16,
    y: area.y + area.height - size.height - 16,
    minWidth: 360,
    minHeight: 96,
    maximizable: false,
    title: 'Teach me, Agent',
  });
  S.panelAnchorBottom = area.y + area.height - 16;
  p.loadFile(path.join(UI, 'panel.html'));
  p.once('ready-to-show', () => {
    applyPanelBounds();
    p.showInactive();
  });
  p.webContents.on('did-finish-load', () => panelInit());
  p.on('close', (e) => {
    if (S.quitting) return;
    e.preventDefault();
    quit('the user closed the panel');
  });
  S.panel = p;
}

function panelInit() {
  panelSend('panel:init', {
    session: publicSession(),
    history: S.history,
    hotkeys: config.hotkeys,
    hotkeyErrors: S.hotkeyErrors,
    overlayHidden: S.overlayHidden,
    config: publicConfig(),
    collapsed: S.panelCollapsed,
    editing: S.editing,
    board: board.snapshot(),
  });
  if (S.tour && S.tour.running) panelSend('panel:tour', { on: true, step: S.tour.step, total: S.tour.total });
  pushState();
}

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
    webPreferences: {
      preload: PRELOAD,
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  w.setIgnoreMouseEvents(true);
  w.setFocusable(false);
  w.setAlwaysOnTop(true, 'screen-saver');
  protect(w);
  const o = { win: w, display, hasContent: false };
  o.ready = new Promise((resolve) => w.webContents.once('did-finish-load', resolve));
  w.loadFile(path.join(UI, 'overlay.html'));
  w.webContents.on('did-finish-load', () => {
    w.webContents.send('overlay:agent-visible', !S.overlayHidden);
    w.webContents.send('overlay:edit', S.editing && display.id === activeId());
    const snap = board.snapshot();
    w.webContents.send('overlay:board', {
      user: snap.user.filter((s) => s.display == null || s.display === display.id),
      agent: snap.agent.filter((s) => s.display == null || s.display === display.id),
    });
  });
  S.overlays.set(display.id, o);
  return o;
}

function syncOverlays() {
  const displays = screen.getAllDisplays();
  for (const [id, o] of S.overlays) {
    if (!displays.some((d) => d.id === id)) {
      if (alive(o.win)) o.win.destroy();
      S.overlays.delete(id);
    }
  }
  for (const d of displays) {
    const o = S.overlays.get(d.id);
    if (!o) createOverlay(d);
    else {
      o.display = d;
      if (alive(o.win)) o.win.setBounds(d.bounds);
    }
  }
}

function showOverlay(o) {
  if (!alive(o.win)) return;
  o.win.setBounds(o.display.bounds);
  o.win.showInactive();
  o.win.setAlwaysOnTop(true, 'screen-saver');
  const editingHere = S.editing && o.display.id === activeId();
  o.win.setIgnoreMouseEvents(!editingHere);
  o.win.setFocusable(editingHere);
  if (alive(S.panel) && S.panel.isVisible()) S.panel.moveTop();
}

function clearGuides() {
  for (const o of S.overlays.values()) {
    o.hasContent = false;
    if (alive(o.win)) o.win.webContents.send('overlay:clear');
  }
  S.scene = null;
  htmlHost.destroy();
}

function clearAgent() {
  clearGuides();
  board.clearAgent();
  syncBoard();
  if (S.session) S.session.record({ from: 'agent', cleared: 'agent' });
}

function clearAllInk() {
  clearAgent();
  board.clearUser();
  syncBoard();
  if (S.session) S.session.record({ from: 'user', cleared: 'all' });
}

async function toggleOverlay() {
  S.overlayHidden = !S.overlayHidden;
  for (const o of S.overlays.values()) {
    if (alive(o.win)) o.win.webContents.send('overlay:agent-visible', !S.overlayHidden);
  }
  if (S.overlayHidden) htmlHost.hide();
  else htmlHost.reveal();
  panelSend('panel:overlay-hidden', S.overlayHidden);
}

async function setEdit(on) {
  const o = S.overlays.get(activeId());
  if (!o || !alive(o.win)) return;
  if (on && !S.editing) {
    const prev = await win.foreground();
    S.editHwnd = prev && !isOurs(prev) ? prev : null;
  }
  S.editing = !!on;
  showOverlay(o);
  o.win.webContents.send('overlay:edit', S.editing);
  panelSend('panel:editing', S.editing);
  if (S.editing) {
    o.win.show();
    o.win.focus();
  } else if (S.editHwnd) {
    const hwnd = S.editHwnd;
    S.editHwnd = null;
    win.activate(hwnd);
  }
}

async function withAgentHidden(fn) {
  S.hideDepth += 1;
  if (S.hideDepth === 1) {
    for (const o of S.overlays.values()) {
      if (alive(o.win)) o.win.webContents.send('overlay:agent-visible', false);
    }
    htmlHost.hide();
    await sleep(70);
  }
  try {
    return await fn();
  } finally {
    S.hideDepth -= 1;
    if (S.hideDepth === 0 && !S.overlayHidden) {
      for (const o of S.overlays.values()) {
        if (alive(o.win)) o.win.webContents.send('overlay:agent-visible', true);
      }
      htmlHost.reveal();
    }
  }
}

async function grabFrame() {
  if (!S.shots) ensureSession('');
  const display = targetDisplay();
  const result = await withAgentHidden(() => withRetries(() => S.shots.grab(display), { attempts: MAX_ATTEMPTS, delayMs: 150 }));
  result.value.attempts = result.attempts;
  return result.value;
}

function rememberGeometry(display) {
  S.lessonGeometry = { scaleFactor: display.scaleFactor, bounds: { ...display.bounds } };
  S.layoutStale = false;
}

async function probeDisplays() {
  if (!S.shots) ensureSession('');
  return withAgentHidden(async () => {
    const out = [];
    for (const d of screen.getAllDisplays()) {
      let captureOk = false;
      if (Number(d.scaleFactor) > 0 && d.bounds && d.bounds.width > 0) {
        try {
          await S.shots.grab(d);
          captureOk = true;
        } catch (e) {
          log(`probe display ${d.id} failed: ${e.message}`);
        }
      }
      const info = inspectDisplay(d, { captureOk });
      info.raw = d;
      S.probes.set(d.id, info);
      out.push(info);
    }
    return out;
  });
}

function wireChoice(kind, file, onChoice) {
  let winRef = null;
  return {
    get win() {
      return winRef;
    },
    open(payload, bounds) {
      if (!alive(winRef)) {
        winRef = chromeWindow({
          width: bounds.width,
          height: bounds.height,
          x: bounds.x,
          y: bounds.y,
          focusable: kind !== 'approval',
          resizable: false,
          movable: false,
        });
        if (kind === 'approval') winRef.setFocusable(false);
        winRef.loadFile(path.join(UI, file));
        winRef.webContents.on('did-finish-load', () => {
          if (alive(winRef)) winRef.webContents.send(payload.channel, payload.data);
        });
      } else {
        winRef.setBounds(bounds);
        winRef.webContents.send(payload.channel, payload.data);
      }
      if (kind === 'approval') winRef.showInactive();
      else {
        winRef.show();
        winRef.focus();
      }
    },
    hide() {
      if (alive(winRef)) winRef.hide();
    },
  };
}

const gateUi = wireChoice('gate', 'gate.html');
const approvalUi = wireChoice('approval', 'approval.html');

function edgeBounds(width, height, corner) {
  const area = workArea();
  const x = corner === 'left' ? area.x + 16 : area.x + area.width - width - 16;
  const y = corner === 'bottom' ? area.y + area.height - height - 16 : area.y + 16;
  return { x, y, width, height };
}

function askGate(data, bounds) {
  if (S.gate.pending) return Promise.resolve({ decision: 'deny', busy: true });
  return new Promise((resolve) => {
    S.gate.pending = resolve;
    if (data.timeoutMs) {
      S.gate.timer = setTimeout(() => finishGate({ decision: null, timedOut: true }), data.timeoutMs);
    }
    gateUi.open({ channel: 'gate:open', data }, bounds);
  });
}

function finishGate(result) {
  if (S.gate.timer) clearTimeout(S.gate.timer);
  S.gate.timer = null;
  const resolve = S.gate.pending;
  S.gate.pending = null;
  gateUi.hide();
  if (resolve) resolve(result || { decision: 'deny' });
}

function askConsent({ purpose, sessionId, emphasizeDefault, timeoutMs }) {
  const active = purpose === 'attach' && emphasizeDefault;
  return askGate(
    {
      kind: 'consent',
      title: purpose === 'attach' ? '有 agent 想连接这次教学' : '有 agent 想开始教学',
      body: active ? '已经有教学在进行。不操作将拒绝这次连接。' : '允许后，它才能在屏幕上说和画。',
      sessionId: sessionId || '',
      emphasizeDefault: !!emphasizeDefault,
      timeoutMs,
    },
    edgeBounds(420, 230, 'bottom'),
  );
}

function askDisplay(list, { title, allowEnd, timeoutMs } = {}) {
  return askGate(
    {
      kind: 'display',
      title: title || '在哪块屏幕上教学',
      displays: list.map(({ raw, ...rest }) => rest),
      allowEnd: !!allowEnd,
      timeoutMs: timeoutMs || 120000,
    },
    edgeBounds(440, 420, 'bottom'),
  );
}

async function chooseDisplay(requested) {
  const probed = await probeDisplays();
  if (requested != null && requested !== '') {
    const found = probed.find((d) => String(d.id) === String(requested));
    if (!found) throw new Error('unknown display ' + requested);
    if (!found.supported) throw new Error('display ' + requested + ' is unsupported');
    return found;
  }
  const choice = await askDisplay(probed);
  if (!choice || choice.timedOut || choice.decision === 'cancel' || choice.displayId == null) return null;
  return probed.find((d) => String(d.id) === String(choice.displayId)) || null;
}

function placeLesson(display) {
  const raw = display.raw || screen.getAllDisplays().find((d) => d.id === display.id) || screen.getPrimaryDisplay();
  S.lessonDisplayId = raw.id;
  rememberGeometry(raw);
  syncOverlays();
  const o = S.overlays.get(raw.id);
  if (o) showOverlay(o);
  applyPanelBounds();
  syncBoard();
}

async function beginLesson({ topic, display }) {
  const was = isActive();
  ensureSession(topic);
  if (!was) {
    S.history = [];
    clearGuides();
    board.clearAgent();
  }
  S.session.topic = topic || S.session.topic || '';
  S.session.connected = true;
  S.session.ended = false;
  if (!S.session.token) S.session.token = crypto.randomBytes(24).toString('hex');
  placeLesson(display);
  if (S.tour) S.tour.abort();
  panelSend('panel:tour', { on: false });
  panelSend('panel:session', { session: publicSession(), history: S.history });
  writeState();
  pushState();
}

async function handleStart(body, headers) {
  // The launching agent skips consent once. Consume the secret and the flag
  // on that call, including when a lesson is already active, so a later
  // start or attach cannot reuse the waiver.
  if (body.launchSecret && S.launchSecret && body.launchSecret === S.launchSecret) {
    S.launchOk = true;
    S.launchSecret = '';
  }
  const launchedApp = !!(S.launchOk && !isActive());
  S.launchOk = false;
  const decision = decideStart({
    launchedApp,
    hasActiveSession: isActive(),
    holdsConnection: holdsConnection(headers),
  });
  if (decision.action === 'deny') {
    return { ok: false, denied: true, reason: decision.reason, session: publicSession() };
  }
  if (decision.action === 'reuse') {
    return { ok: true, reused: true, session: publicSession(), hotkeys: config.hotkeys, hotkeyErrors: S.hotkeyErrors };
  }
  if (decision.action === 'prompt') {
    const answer = await askConsent({ purpose: 'start', emphasizeDefault: true, timeoutMs: decision.timeoutMs });
    const settled = decideAttach({
      sessionMatches: true,
      hasActiveSession: false,
      decision: answer.decision,
      timedOut: !!answer.timedOut,
    });
    if (settled.action !== 'allow') return { ok: false, denied: true, reason: settled.reason, session: publicSession() };
  }
  const display = await chooseDisplay(body.displayId);
  if (!display) return { ok: false, denied: true, reason: 'display-cancelled', session: publicSession() };
  await beginLesson({ topic: body.topic ? String(body.topic) : '', display });
  if (body.say) say(String(body.say));
  return {
    ok: true,
    session: publicSession(),
    hotkeys: config.hotkeys,
    hotkeyErrors: S.hotkeyErrors,
    display: { id: display.id, bounds: display.bounds, scaleFactor: display.scaleFactor },
  };
}

async function handleAttach(body) {
  const id = body.session ? String(body.session) : '';
  const matches = !!(S.session && S.session.id === id);
  let decision = decideAttach({ sessionMatches: matches, hasActiveSession: isActive() });
  if (decision.action === 'deny') return { ok: false, denied: true, reason: decision.reason, session: publicSession() };
  const answer = await askConsent({
    purpose: 'attach',
    sessionId: id,
    emphasizeDefault: decision.emphasizeDefault,
    timeoutMs: decision.timeoutMs,
  });
  decision = decideAttach({
    sessionMatches: true,
    hasActiveSession: isActive(),
    decision: answer.decision,
    timedOut: !!answer.timedOut,
  });
  if (decision.action !== 'allow') return { ok: false, denied: true, reason: decision.reason, session: publicSession() };
  S.session.connected = true;
  S.session.token = crypto.randomBytes(24).toString('hex');
  writeState();
  panelSend('panel:session', { session: publicSession(), history: S.history });
  return { ok: true, session: publicSession(), hotkeys: config.hotkeys, hotkeyErrors: S.hotkeyErrors };
}

function lessonRaw() {
  return screen.getAllDisplays().find((d) => d.id === S.lessonDisplayId) || null;
}

function shotIsStale(id) {
  if (!id || id === 'screen' || !S.shots) return false;
  let shot;
  try {
    shot = S.shots.get(id);
  } catch {
    return true;
  }
  const current = screen.getAllDisplays().find((d) => d.id === shot.display.id);
  return layoutChanged(shot.display, current ? { scaleFactor: current.scaleFactor, bounds: current.bounds } : null);
}

function sceneForLog(scene, htmlItems) {
  const htmlByIndex = new Map(htmlItems.map((item) => [item.hash, item]));
  return {
    ...scene,
    items: (Array.isArray(scene.items) ? scene.items : []).map((item) => {
      if (!item || item.type !== 'html') return item;
      const prepared = htmlItems.find((h) => h.html === item.html);
      return { type: 'html', hash: prepared && prepared.hash, bytes: prepared && prepared.bytes, rect: item.rect };
    }),
    htmlSeen: [...htmlByIndex.keys()],
  };
}

async function showScene(scene) {
  assertSay(scene);
  ensureSession('');
  const expanded = expandScene(scene);
  const single = singleScene(scene);
  const warnings = [...expanded.warnings, ...single.warnings];
  const displays = screen.getAllDisplays();
  const resolved = resolveScene(expanded.scene, {
    shots: S.shots,
    defaultShot: S.defaultShot,
    displays,
    primary: screen.getPrimaryDisplay(),
  });
  warnings.push(...resolved.warnings);
  const stale = resolved.shots.some((id) => shotIsStale(id));
  if (scene.say) say(String(scene.say));
  if (stale) {
    S.layoutStale = true;
    notice(STALE_PROMPT);
    warnings.push(STALE_PROMPT);
    S.session.record({ from: 'agent', scene: { say: scene.say, stale: true } });
    return { id: S.scene && S.scene.id, drawn: [], shots: resolved.shots, warnings, stale: true, overlayHidden: S.overlayHidden };
  }
  const htmlItems = resolved.items.filter((item) => item.type === 'html');
  const strokes = resolved.items.filter((item) => item.type === 'stroke');
  const guides = resolved.items.filter((item) => item.type !== 'html' && item.type !== 'stroke');
  if (htmlItems.length > 1) warnings.push('one html scene at a time; extra html items were dropped');
  const html = htmlItems[0] || null;
  clearGuides();
  board.setAgent(strokes.map((item) => ({ points: item.points, display: item.display })));
  const id = ++S.sceneSeq;
  const byDisplay = new Map();
  for (const item of guides) {
    if (!byDisplay.has(item.display)) byDisplay.set(item.display, []);
    byDisplay.get(item.display).push(item);
  }
  for (const o of S.overlays.values()) {
    const list = byDisplay.get(o.display.id) || [];
    await o.ready;
    if (!alive(o.win)) continue;
    o.win.webContents.send('overlay:scene', { id, items: list, keep: false });
    o.hasContent = list.length > 0;
    if (list.length || o.display.id === activeId()) showOverlay(o);
  }
  if (html) {
    const display = displays.find((d) => d.id === html.display) || screen.getPrimaryDisplay();
    const [x, y, w, h] = html.rect;
    await htmlHost.show({
      x: display.bounds.x + x,
      y: display.bounds.y + y,
      width: w,
      height: h,
      srcdoc: html.srcdoc,
      opacity: html.opacity,
      ttlMs: html.ttl,
      hideFromCapture: !config.showInScreenCapture,
    });
    if (S.overlayHidden) htmlHost.hide();
  }
  syncBoard();
  S.scene = {
    id,
    types: [...guides.map((item) => item.type), ...(strokes.length ? ['stroke'] : []), ...(html ? ['html'] : [])],
    shots: resolved.shots,
    html: !!html,
    hashes: html ? [html.hash] : [],
    at: Date.now(),
  };
  S.session.touch();
  S.session.record({ from: 'agent', scene: sceneForLog(expanded.scene, html ? [html] : []), hashes: S.scene.hashes });
  return {
    id,
    drawn: S.scene.types,
    shots: resolved.shots,
    warnings,
    overlayHidden: S.overlayHidden,
    hashes: S.scene.hashes,
  };
}

async function exportBoardPng() {
  const o = S.overlays.get(activeId());
  if (!o || !alive(o.win)) return null;
  try {
    const dataUrl = await o.win.webContents.executeJavaScript('window.exportBoard && window.exportBoard()');
    if (!dataUrl || String(dataUrl).indexOf(',') < 0) return null;
    return Buffer.from(String(dataUrl).split(',')[1], 'base64');
  } catch (e) {
    log('board export failed: ' + e.message);
    return null;
  }
}

async function shotsForSend(frame, attachBoard) {
  const shots = [];
  if (frame) shots.push(S.shots.fromFrame(frame, null, 'user', 'screen at send time'));
  if (attachBoard && board.hasContent()) {
    const png = await exportBoardPng();
    const display = targetDisplay();
    if (png) {
      const fake = { id: 'board', display: { id: display.id, bounds: { ...display.bounds }, scaleFactor: display.scaleFactor } };
      shots.push(S.shots.fromPng(png, fake, { ...display.bounds }, 'board', 'board ink at send time'));
    }
  }
  return shots;
}

async function rememberFg() {
  const prev = await win.foreground();
  return prev && !isOurs(prev) ? prev : null;
}

function openInput() {
  const cursor = screen.getCursorScreenPoint();
  const area = screen.getDisplayNearestPoint(cursor).workArea;
  const width = 420;
  const height = 220;
  const x = Math.min(Math.max(area.x + 8, cursor.x - 40), area.x + area.width - width - 8);
  const y = Math.min(Math.max(area.y + 8, cursor.y + 12), area.y + area.height - height - 8);
  if (!alive(S.inputWin)) {
    S.inputWin = chromeWindow({ width, height, x, y, resizable: false, minimizable: false, maximizable: false, title: '写一句' });
    S.inputWin.loadFile(path.join(UI, 'input.html'));
    S.inputWin.on('close', (e) => {
      if (S.quitting) return;
      e.preventDefault();
      cancelInput();
    });
  } else S.inputWin.setBounds({ x, y, width, height });
  const send = () => {
    if (!alive(S.inputWin)) return;
    S.inputWin.webContents.send('input:open', {
      hasBoard: board.hasContent(),
      attachBoard: board.snapshot().attach,
      shot: !!S.input.frame,
    });
    S.inputWin.show();
    S.inputWin.focus();
  };
  if (S.inputWin.webContents.isLoading()) S.inputWin.webContents.once('did-finish-load', send);
  else send();
}

async function beginText() {
  if (S.voice.open || S.input.open) return;
  S.input.open = true;
  S.input.prev = await rememberFg();
  S.input.frame = null;
  if (config.attachScreenshot !== false) {
    try {
      S.input.frame = await grabFrame();
    } catch (e) {
      log('user capture failed: ' + e.message);
      notice('截屏失败：' + (e.message || 'capture failed'));
    }
  }
  openInput();
}

function cancelInput() {
  const prev = S.input.prev;
  S.input = { open: false, frame: null, prev: null };
  if (alive(S.inputWin)) S.inputWin.hide();
  if (prev) win.activate(prev);
}

async function submitInput({ text, attachBoard }) {
  const value = String(text || '').trim();
  const frame = S.input.frame;
  const prev = S.input.prev;
  S.input = { open: false, frame: null, prev: null };
  if (alive(S.inputWin)) S.inputWin.hide();
  if (!value) {
    if (prev) win.activate(prev);
    return;
  }
  const shots = await shotsForSend(frame, attachBoard);
  deliver({ source: 'text', text: value, shots });
  if (prev) win.activate(prev);
}

async function beginVoice() {
  if (S.voice.open) return;
  const gen = ++S.voice.gen;
  S.voice.open = true;
  S.voice.stopping = false;
  S.voice.listening = false;
  S.voice.stash = null;
  S.voice.prev = await rememberFg();
  S.voice.attachBoard = !!(board.snapshot().attach && board.hasContent());
  S.voice.frame = null;
  if (config.attachScreenshot !== false) {
    try {
      S.voice.frame = await grabFrame();
    } catch (e) {
      log('voice capture failed: ' + e.message);
      notice('截屏失败：' + (e.message || 'capture failed'));
    }
  }
  if (S.voice.gen !== gen) return;
  if (S.voice.stopping) {
    S.voice.open = false;
    S.voice.stopping = false;
    flashVoice('');
    return;
  }
  S.voice.listening = true;
  panelSend('panel:listen', { on: true, engine: config.voice.engine || 'system' });
}

function confirmMs() {
  const n = Number(config.voice.confirmMs);
  if (!Number.isFinite(n)) return 1500;
  return Math.min(2000, Math.max(1000, n));
}

function flashVoice(text) {
  const value = String(text || '').trim();
  const frame = S.voice.frame;
  const prev = S.voice.prev;
  const attachBoard = S.voice.attachBoard;
  S.voice.frame = null;
  S.voice.prev = null;
  if (!value) {
    setCollapsed(false);
    notice('没有听清');
    panelSend('panel:voice-flash', null);
    if (prev) win.activate(prev);
    return;
  }
  setCollapsed(false);
  const pending = { text: value, frame, attachBoard, prev };
  panelSend('panel:voice-flash', { text: value, ms: confirmMs() });
  if (S.voice.timer) clearTimeout(S.voice.timer);
  S.voice.pending = pending;
  S.voice.timer = setTimeout(() => {
    commitVoice(pending).catch((e) => log('voice commit failed: ' + e.stack));
  }, confirmMs());
}

async function commitVoice(pending) {
  if (!pending || S.voice.pending !== pending) return;
  S.voice.pending = null;
  S.voice.timer = null;
  panelSend('panel:voice-flash', null);
  const shots = await shotsForSend(pending.frame, pending.attachBoard);
  deliver({ source: 'voice', text: pending.text, shots });
  if (pending.prev) win.activate(pending.prev);
}

function undoVoice() {
  if (S.voice.timer) clearTimeout(S.voice.timer);
  const pending = S.voice.pending;
  S.voice.pending = null;
  S.voice.timer = null;
  panelSend('panel:voice-flash', null);
  if (pending && pending.prev) win.activate(pending.prev);
}

async function endVoice() {
  if (!S.voice.open) return;
  S.voice.stopping = true;
  if (!S.voice.listening) return;
  S.voice.open = false;
  S.voice.listening = false;
  panelSend('panel:listen', { on: false });
  if (S.voice.stash) {
    const stashed = S.voice.stash;
    S.voice.stash = null;
    S.voice.stopping = false;
    await finishVoicePayload(stashed);
    return;
  }
  if (S.voice.resultTimer) clearTimeout(S.voice.resultTimer);
  S.voice.resultTimer = setTimeout(() => {
    S.voice.stopping = false;
    finishVoicePayload({ text: '' });
  }, 8000);
}

async function finishVoicePayload(payload) {
  if (S.voice.resultTimer) clearTimeout(S.voice.resultTimer);
  S.voice.resultTimer = null;
  S.voice.stash = null;
  if (!payload) return flashVoice('');
  if (payload.error) {
    const known = {
      'no-system-speech': '这台机器没有可用的系统语音识别',
      'mic-denied': '没有麦克风权限',
    };
    notice(known[payload.error] || payload.error);
    S.voice.frame = null;
    return;
  }
  flashVoice(payload.text || '');
}

function postAudio(url, data, mime) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch {
      reject(new Error('custom voice URL is invalid'));
      return;
    }
    const lib = target.protocol === 'https:' ? https : http;
    const req = lib.request(
      target,
      {
        method: 'POST',
        headers: { 'content-type': mime || 'application/octet-stream', 'content-length': data.length },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          try {
            const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
            resolve(json.text || json.transcript || '');
          } catch (e) {
            reject(e);
          }
        });
      },
    );
    req.on('error', reject);
    req.setTimeout(20000, () => {
      req.destroy(new Error('custom voice API timed out'));
    });
    req.end(data);
  });
}

function runLocalAsr(command, data, mime) {
  const ext = /wav/i.test(mime || '') ? 'wav' : 'webm';
  const file = path.join(os.tmpdir(), `tma-${Date.now()}.${ext}`);
  fs.writeFileSync(file, data);
  return new Promise((resolve, reject) => {
    const child = spawn(command, [file], { windowsHide: true });
    const out = [];
    const err = [];
    child.stdout.on('data', (c) => out.push(c));
    child.stderr.on('data', (c) => err.push(c));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('local speech engine timed out'));
    }, 20000);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.unlink(file, () => {});
      if (code !== 0) reject(new Error(Buffer.concat(err).toString('utf8').trim() || 'local speech engine failed'));
      else resolve(Buffer.concat(out).toString('utf8').trim());
    });
  });
}

async function transcribe(payload) {
  const data = Buffer.from(payload.data || []);
  if ((config.voice.engine || 'system') === 'custom') {
    if (!config.voice.customUrl) throw new Error('自定义语音 API 还没填写');
    return postAudio(config.voice.customUrl, data, payload.mime);
  }
  if (config.voice.engine === 'local') {
    if (!config.voice.localCommand) throw new Error('本地语音引擎还没配置');
    return runLocalAsr(config.voice.localCommand, data, payload.mime);
  }
  throw new Error('当前语音引擎不接收音频');
}

function onVoiceResult(payload) {
  if (S.voice.listening && !S.voice.stopping) {
    S.voice.stash = payload;
    return;
  }
  if (!S.voice.stopping && !S.voice.resultTimer) return;
  S.voice.stopping = false;
  if (S.voice.resultTimer) clearTimeout(S.voice.resultTimer);
  S.voice.resultTimer = null;
  finishVoicePayload(payload);
}

async function sendContinue() {
  const frame = config.attachScreenshot === false ? null : await grabFrame().catch((e) => {
    notice('截屏失败：' + (e.message || 'capture failed'));
    return null;
  });
  const shots = await shotsForSend(frame, board.snapshot().attach);
  deliver({ source: 'continue', text: '继续', shots });
}

function showApproval(state) {
  approvalUi.open({ channel: 'approval:state', data: state }, edgeBounds(340, 132, 'top'));
}

async function agentCapture({ includeTitle }) {
  const display = targetDisplay();
  const probed = S.probes.get(display.id);
  if (probed && probed.supported === false) throw new Error('display ' + display.id + ' is unsupported');
  const frame = await grabFrame();
  const shot = S.shots.fromFrame(frame, null, 'capture', 'agent capture');
  rememberGeometry(display);
  const extra = await win.captureContext({ includeTitle: !!includeTitle });
  const mouse = screen.getCursorScreenPoint();
  const context = lightweightContext(
    {
      focusedProcess: extra && extra.focusedProcess,
      mouse: (extra && extra.mouse) || mouse,
      foregroundBounds: extra && extra.foregroundBounds,
      windowTitle: extra && extra.windowTitle,
    },
    { includeTitle: !!includeTitle },
  );
  return { shot: publicShot(shot), context, attempts: frame.attempts || 1 };
}

function requestAgentCapture({ includeTitle }) {
  const state = beginCapture(config.capture && config.capture.tier);
  if (state.phase === 'approved') return agentCapture({ includeTitle });
  return new Promise((resolve, reject) => {
    S.capture.wait = { resolve, reject, includeTitle, phase: state.phase };
    showApproval(state);
    if (state.phase === 'countdown') {
      S.capture.timer = setTimeout(() => settleCapture('timeout'), state.countdownMs);
    }
  });
}

async function settleCapture(decision) {
  const wait = S.capture.wait;
  if (!wait) return;
  const next = applyCaptureDecision({ phase: wait.phase, countdownMs: 0 }, decision);
  wait.phase = next.phase;
  if (next.phase === 'pending') {
    if (S.capture.timer) clearTimeout(S.capture.timer);
    S.capture.timer = null;
    showApproval(next);
    return;
  }
  if (S.capture.timer) clearTimeout(S.capture.timer);
  S.capture.timer = null;
  S.capture.wait = null;
  approvalUi.hide();
  if (next.phase === 'denied') {
    wait.reject(httpError('capture denied', 403, { reason: 'denied', denied: true }));
    return;
  }
  try {
    wait.resolve(await agentCapture({ includeTitle: wait.includeTitle }));
  } catch (e) {
    wait.reject(e);
  }
}

function onCaptureHotkey() {
  if (!S.capture.wait) return;
  const action = hotkeyOnCapture(S.capture.wait.phase);
  if (action === 'interrupt') settleCapture('interrupt');
  else if (action === 'allow') settleCapture('allow');
}

async function onTalk() {
  if (S.inputLock) return;
  S.inputLock = true;
  try {
    const vks = acceleratorVks(config.hotkeys.talk);
    const held = await resolveHold(() => (vks ? win.chordDown(vks) : Promise.resolve(null)));
    if (held.held) {
      await beginVoice();
      while (vks && (await win.chordDown(vks))) await sleep(40);
      await endVoice();
    } else await beginText();
  } catch (e) {
    log('talk failed: ' + e.stack);
  } finally {
    S.inputLock = false;
  }
}

function onPointer(phase) {
  if (phase === 'down') {
    if (S.pointerTimer || S.inputLock) return;
    pointerGesture.down(Date.now());
    S.pointerTimer = setTimeout(() => {
      S.pointerTimer = null;
      const tick = pointerGesture.tick(Date.now());
      if (tick.became === 'voice') beginVoice().catch((e) => log(e.stack));
    }, HOLD_MS);
    return;
  }
  if (S.pointerTimer) {
    clearTimeout(S.pointerTimer);
    S.pointerTimer = null;
  }
  const result = pointerGesture.up(Date.now());
  if (result.became === 'text') beginText().catch((e) => log(e.stack));
  else if (result.release) endVoice().catch((e) => log(e.stack));
}

const HOTKEY_LABELS = {
  talk: '输入',
  toggleOverlay: '隐藏/显示指引',
  continue: '继续',
  boardEdit: '画板编辑',
  captureAllow: '截屏审批',
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  S.hotkeyErrors = [];
  const used = new Set();
  const actions = {
    talk: onTalk,
    toggleOverlay,
    continue: () => sendContinue().catch((e) => log(e.stack)),
    boardEdit: () => setEdit(!S.editing),
    captureAllow: onCaptureHotkey,
  };
  for (const [name, fn] of Object.entries(actions)) {
    const acc = config.hotkeys[name];
    if (!acc) continue;
    if (used.has(acc)) {
      S.hotkeyErrors.push(`${acc}（${HOTKEY_LABELS[name]}）和另一个快捷键重复了`);
      continue;
    }
    used.add(acc);
    let ok = false;
    try {
      ok = globalShortcut.register(acc, () => {
        Promise.resolve(fn()).catch((e) => log(`hotkey ${name} failed: ${e.stack}`));
      });
    } catch (e) {
      log(`hotkey ${acc} invalid: ${e.message}`);
    }
    if (!ok) S.hotkeyErrors.push(`${acc}（${HOTKEY_LABELS[name]}）注册失败，可能被占用`);
  }
}

function openSettings() {
  if (!alive(S.settingsWin)) {
    const area = workArea();
    S.settingsWin = chromeWindow({
      width: 520,
      height: 680,
      x: area.x + Math.max(16, (area.width - 520) / 2),
      y: area.y + 40,
      title: '设置',
      skipTaskbar: false,
    });
    S.settingsWin.loadFile(path.join(UI, 'settings.html'));
    S.settingsWin.on('close', (e) => {
      if (S.quitting) return;
      e.preventDefault();
      S.settingsWin.hide();
    });
  }
  const send = () => {
    if (alive(S.settingsWin)) S.settingsWin.webContents.send('settings:init', { config: publicConfig(), hotkeyErrors: S.hotkeyErrors });
  };
  if (S.settingsWin.webContents.isLoading()) S.settingsWin.webContents.once('did-finish-load', send);
  else send();
  S.settingsWin.show();
  S.settingsWin.focus();
}

function sanitizeSettings(patch) {
  const voice = patch.voice || {};
  const capture = patch.capture || {};
  const appearance = patch.appearance || {};
  return {
    hotkeys: patch.hotkeys || {},
    attachScreenshot: !!patch.attachScreenshot,
    voice: {
      engine: ENGINES.has(voice.engine) ? voice.engine : 'system',
      localCommand: String(voice.localCommand || '').slice(0, 500),
      customUrl: String(voice.customUrl || '').slice(0, 500),
      tts: TTS.has(voice.tts) ? voice.tts : 'off',
      confirmMs: Math.min(2000, Math.max(1000, Number(voice.confirmMs) || 1500)),
    },
    capture: { tier: TIERS.has(capture.tier) ? capture.tier : 'ask' },
    appearance: {
      mode: MODES.has(appearance.mode) ? appearance.mode : 'capsule',
      autoCollapseSec: Math.max(0, Math.min(120, Number(appearance.autoCollapseSec) || 0)),
    },
  };
}

function saveSettings(patch) {
  config = P.saveConfig(sanitizeSettings(patch));
  registerHotkeys();
  applyPanelBounds();
  panelSend('panel:config', publicConfig());
  if (alive(S.settingsWin)) S.settingsWin.webContents.send('settings:saved', { config: publicConfig(), hotkeyErrors: S.hotkeyErrors });
}

function startTour() {
  if (!S.tour) return;
  if (S.tour.running) S.tour.abort();
  ensureSession('');
  S.tour.start();
}

function finishTour(reason) {
  config = P.saveConfig({ onboarded: true });
  clearAgent();
  panelSend('panel:tour', { on: false });
  if (reason === 'skip') notice('引导已跳过。可以在设置里再看一次。');
}

S.tour = createTour({
  show: (scene) => showScene(scene),
  onStep(step) {
    panelSend('panel:tour', { on: true, ...step });
    setCollapsed(false);
  },
  onDone: finishTour,
});

async function onDisplayGone() {
  if (S.gate.pending) return;
  S.lessonDisplayId = null;
  S.layoutStale = true;
  S.overlayHidden = true;
  htmlHost.hide();
  for (const o of S.overlays.values()) {
    if (alive(o.win)) o.win.webContents.send('overlay:agent-visible', false);
  }
  notice('教学屏幕断开了。请重新选屏，或结束教学。');
  if (isActive()) {
    S.session.push({ kind: 'message', source: 'system', text: '教学屏幕断开了。指引已暂停。', shots: [] });
  }
  const probed = await probeDisplays();
  const choice = await askDisplay(probed, { title: '教学屏幕断开了', allowEnd: true, timeoutMs: 120000 });
  if (!choice || choice.decision === 'cancel' || choice.timedOut) return;
  if (choice.decision === 'end') {
    if (S.session && !S.session.ended) S.session.end();
    clearAgent();
    pushState();
    return;
  }
  const display = probed.find((d) => String(d.id) === String(choice.displayId));
  if (!display || !display.supported) return;
  S.overlayHidden = false;
  placeLesson(display);
  notice('已换到另一块屏幕。请让 agent 重新截屏再画。');
  if (isActive()) {
    S.session.push({
      kind: 'message',
      source: 'system',
      text: `教学屏幕已换到 ${display.id}。请重新 capture 再画。`,
      shots: [],
    });
  }
}

function noteLayout() {
  const current = lessonRaw();
  if (!current || !S.lessonGeometry) return;
  const changed = layoutChanged(S.lessonGeometry, current);
  if (changed && !S.layoutStale) {
    S.layoutStale = true;
    notice(STALE_PROMPT);
  } else if (!changed) S.layoutStale = false;
}

function writeState() {
  const body = {
    pid: process.pid,
    port: S.port,
    token: S.token,
    sessionId: S.session ? S.session.id : null,
    sessionToken: S.session && S.session.connected ? S.session.token : null,
    version: VERSION,
    startedAt: Date.now(),
  };
  fs.writeFileSync(P.stateFile, JSON.stringify(body), { mode: 0o600 });
  fs.chmodSync(P.stateFile, 0o600);
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
  htmlHost.destroy();
  if (S.session) S.session.close(reason);
  removeState();
  setTimeout(() => app.quit(), 250);
}

function displayStatus() {
  return screen.getAllDisplays().map((d) => {
    const probed = S.probes.get(d.id);
    return {
      id: d.id,
      bounds: d.bounds,
      scaleFactor: d.scaleFactor,
      supported: probed ? probed.supported : null,
      reason: probed ? probed.reason : '',
    };
  });
}

const routes = {
  'GET /health': () => ({ ok: true, pid: process.pid, version: VERSION, session: publicSession() }),

  'POST /session/start': async ({ body, headers }) => {
    S.startInProgress = true;
    try {
      return await handleStart(body || {}, headers);
    } finally {
      S.startInProgress = false;
    }
  },

  'POST /session/attach': ({ body }) => handleAttach(body || {}),

  'GET /displays': async () => ({ displays: (await probeDisplays()).map(({ raw, ...rest }) => rest) }),

  'GET /wait': async ({ query, onAbort, headers }) => {
    requireDriver(headers);
    const seconds = Math.min(3600, Math.max(1, Number(query.get('timeout')) || 480));
    const session = S.session;
    const result = await session.wait(seconds * 1000, onAbort);
    if (result.messages) {
      const withShot = [...result.messages].reverse().find((m) => m.shots && m.shots.length);
      if (withShot) S.defaultShot = withShot.shots[0].id;
    }
    return withoutCaptureContext({
      ...result,
      session: session.id,
      defaultShot: S.defaultShot,
      scene: S.scene,
      overlayHidden: S.overlayHidden,
    });
  },

  'POST /ack': ({ body, headers }) => {
    requireDriver(headers);
    S.session.ack(Number(body.id) || 0);
    return { ok: true };
  },

  'POST /say': ({ body, headers }) => {
    requireDriver(headers);
    if (!body.text || !String(body.text).trim()) throw new Error('say needs text');
    const text = String(body.text);
    say(text);
    if (body.copy) clipboard.writeText(text);
    return { ok: true, copied: !!body.copy };
  },

  'POST /show': ({ body, headers }) => {
    requireDriver(headers);
    return showScene(body.scene || body);
  },

  'POST /clear': ({ body, headers }) => {
    requireDriver(headers);
    if (body.scope === 'all') clearAllInk();
    else clearAgent();
    S.session.touch();
    return { ok: true, scope: body.scope === 'all' ? 'all' : 'agent' };
  },

  'POST /capture': ({ body, headers }) => {
    requireDriver(headers);
    return requestAgentCapture({ includeTitle: !!(body && body.title) });
  },

  'POST /zoom': ({ body, headers }) => {
    requireDriver(headers);
    if (!Array.isArray(body.rect) || body.rect.length < 4) throw new Error('zoom needs rect [x,y,w,h]');
    return { shot: publicShot(S.shots.zoom(body.shot, body.rect.map(Number))) };
  },

  'GET /board': ({ headers }) => {
    requireDriver(headers);
    const snap = board.snapshot();
    return { hasContent: snap.hasContent, userStrokes: snap.user.length, agentStrokes: snap.agent.length };
  },

  'GET /status': () => ({
    version: VERSION,
    session: publicSession(),
    agent: S.session ? S.session.agentState() : 'offline',
    pending: S.session ? S.session.pending().length : 0,
    defaultShot: S.defaultShot,
    scene: S.scene,
    overlayHidden: S.overlayHidden,
    editing: S.editing,
    layoutStale: S.layoutStale,
    captureTier: config.capture.tier,
    board: { hasContent: board.hasContent(), userStrokes: board.user.length, agentStrokes: board.agent.length },
    hotkeys: config.hotkeys,
    hotkeyErrors: S.hotkeyErrors,
    recentShots: S.shots ? [...S.shots.shots.values()].slice(-6).map(publicShot) : [],
    primaryDisplay: screen.getPrimaryDisplay().id,
    lessonDisplay: S.lessonDisplayId,
    displays: displayStatus(),
  }),

  'POST /tour': () => {
    startTour();
    return { ok: true };
  },

  'POST /stop': () => {
    setTimeout(() => quit('stopped by the agent'), 150);
    return { ok: true };
  },
};

if (DEBUG) {
  routes['POST /debug/eval'] = ({ body }) => {
    const target = body.target === 'panel' ? S.panel : S.overlays.get(Number(String(body.target).split(':')[1]))?.win;
    if (!alive(target)) throw new Error('unknown debug target');
    return target.webContents.executeJavaScript(String(body.js));
  };
}

ipcMain.on('input:pointer', (_e, data) => onPointer(data && data.phase));
ipcMain.on('input:submit', (_e, data) => submitInput(data || {}).catch((e) => log(e.stack)));
ipcMain.on('input:cancel', () => cancelInput());
ipcMain.on('panel:continue', () => sendContinue().catch((e) => log(e.stack)));
ipcMain.on('panel:board-edit', () => setEdit(!S.editing).catch((e) => log(e.stack)));
ipcMain.on('panel:toggle-overlay', () => toggleOverlay());
ipcMain.on('panel:toggle-expand', () => {
  setCollapsed(!S.panelCollapsed);
  if (!S.panelCollapsed) armAutoCollapse();
});
ipcMain.on('panel:hover', (_e, data) => {
  S.panelHover = !!(data && data.on);
  if (S.panelHover) {
    if (S.collapseTimer) clearTimeout(S.collapseTimer);
  } else armAutoCollapse();
});
ipcMain.on('panel:clear-user', () => {
  board.clearUser();
  syncBoard();
  if (S.session) S.session.record({ from: 'user', cleared: 'user' });
});
ipcMain.on('panel:clear-agent', () => clearAgent());
ipcMain.on('panel:settings', () => openSettings());
ipcMain.on('panel:copy-id', () => {
  if (S.session) clipboard.writeText(S.session.id);
});
ipcMain.on('panel:end', () => {
  if (!S.session || S.session.ended) return;
  S.session.end();
  clearAgent();
  pushState();
});
ipcMain.on('panel:quit', () => quit('the user closed the panel'));
ipcMain.on('panel:attach-board', (_e, data) => {
  board.setAttach(!!(data && data.on), { touched: true });
  panelSend('panel:board', board.snapshot());
});
ipcMain.on('panel:voice-undo', () => undoVoice());
ipcMain.on('voice:result', (_e, payload) => onVoiceResult(payload || {}));
ipcMain.on('voice:audio', (_e, payload) => {
  transcribe(payload || {})
    .then((text) => onVoiceResult({ text }))
    .catch((e) => onVoiceResult({ error: e.message }));
});
ipcMain.on('board:stroke', (_e, stroke) => {
  board.addUser({ points: stroke && stroke.points, display: activeId() });
  syncBoard();
});
ipcMain.on('board:edit-off', () => setEdit(false).catch((e) => log(e.stack)));
ipcMain.on('tour:next', () => S.tour && S.tour.next());
ipcMain.on('tour:skip', () => S.tour && S.tour.skip());
ipcMain.on('gate:choice', (_e, data) => finishGate(data || { decision: 'deny' }));
ipcMain.on('approval:choice', (_e, data) => settleCapture(data && data.decision));
ipcMain.on('settings:save', (_e, patch) => saveSettings(patch || {}));
ipcMain.on('settings:tour', () => {
  config = P.saveConfig({ onboarded: false });
  startTour();
});
ipcMain.on('voice:dictate', () => win.dictate());

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
    syncOverlays();
    registerHotkeys();
    createPanel();
    win.warm();
    const started = await startServer({ token: S.token, routes, log });
    S.port = started.port;
    writeState();
    screen.on('display-added', () => {
      syncOverlays();
      syncBoard();
    });
    screen.on('display-removed', () => {
      syncOverlays();
      if (S.lessonDisplayId && !screen.getAllDisplays().some((d) => d.id === S.lessonDisplayId)) {
        onDisplayGone().catch((e) => log(e.stack));
      }
    });
    screen.on('display-metrics-changed', () => {
      syncOverlays();
      noteLayout();
    });
    setInterval(pushState, 5000);
    setTimeout(() => {
      if (!config.onboarded && !isActive() && !S.startInProgress) startTour();
    }, 800);
    log(`ready on port ${S.port}`);
  } catch (e) {
    log('startup failed: ' + e.stack);
    app.exit(1);
  }
});
