import {
  app,
  BrowserWindow,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen,
} from 'electron';
import { createServer } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { actionSchema, defaults, settingsSchema } from '../shared/protocol.ts';
import type { Action, Guide, Settings, Shot, Snapshot } from '../shared/protocol.ts';
import { Session } from '../core/session.ts';
import { InputController } from '../core/input.ts';
import { mapGuides, parseScene } from '../core/scene.ts';
import { WindowsAdapter } from './windows.ts';
import { HtmlHost } from './html.ts';
import { zoomShot } from './zoom.ts';
import { VoiceController } from '../core/voice.ts';
import { SystemSpeech, transcribe } from './speech.ts';
import { pruneSessions } from './storage.ts';
import { IMAGE_EDGE } from '../shared/limits.ts';
import { setWindowInput } from './window-policy.ts';
import { failureMetadata, writeRuntimeEvent } from './runtime-log.ts';
import { panelBounds } from '../core/panel-layout.ts';

app.setName('Teach me, Agent');
app.commandLine.appendSwitch('enable-features', 'AllowWindowCaptureExclusionInRemoteSessions');
app.setPath(
  'userData',
  process.env.TEACH_ME_AGENT_HOME || path.join(app.getPath('appData'), 'teach-me-agent-v2'),
);
if (!app.requestSingleInstanceLock()) {
  console.log('应用已在运行，本次启动退出；不会创建第二个窗口。');
  app.exit(0);
}
const home = app.getPath('userData');
const endpointFile = path.join(home, 'endpoint.json');
function runtimeEvent(event: string, detail: Record<string, string | number | boolean> = {}) {
  writeRuntimeEvent(home, event, detail);
}
process.on('uncaughtExceptionMonitor', (error, origin) => {
  runtimeEvent('main-exception', { origin, ...failureMetadata(error) });
});
app.on('second-instance', () => runtimeEvent('second-instance'));
const auth = randomBytes(24).toString('hex');
let launchSecret = process.env.TMA_LAUNCH_SECRET || '';
let session: Session | null = null;
let panel: BrowserWindow;
let overlay: BrowserWindow;
let settings: Settings = { ...defaults };
let displayId: number | null = null;
let collapsed = true,
  hover = false,
  guidesHidden = false,
  editing = false;
let expandedHeight = 420,
  collapsedHeight = 76;
const panelPositionSchema = z.object({
  version: z.literal(1),
  displayId: z.number().int(),
  right: z.number().finite(),
  bottom: z.number().finite(),
});
let panelPosition: z.infer<typeof panelPositionSchema> | null = null;
let movingPanel = false;
let pointerDrag: { id: string; bounds: { x: number; y: number } } | null = null;
let guides: Guide[] = [];
let userBoard = { epoch: 0, count: 0 };
function clearUserBoard() {
  userBoard = { epoch: userBoard.epoch + 1, count: 0 };
}
let error: string | null = null;
let revision = 0,
  shotSequence = 0;
let lastExternal: string | null = null;
let lastForeground: string | null = null;
let lastShot: Shot | null = null;
const shots = new Map<string, Shot>();
const originals = new Map<string, string>();
const htmlHost = new HtmlHost((reason) => {
  guides = guides.filter((g) => g.type !== 'html');
  if (reason) error = reason;
  broadcast();
});
const windows = new WindowsAdapter();
const systemSpeech = new SystemSpeech();
let pendingAudio: {
  resolve: (value: { data: Uint8Array; mime: string }) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let collapseTimer: ReturnType<typeof setTimeout> | null = null;
let fgTimer: ReturnType<typeof setInterval> | null = null;
let captureState: Snapshot['capture'] = null;
let captureRequest: {
  resolve: (allow: boolean) => void;
  timer: ReturnType<typeof setTimeout> | null;
} | null = null;
let connection: Snapshot['connection'] = null;
let connectionRequest: ((allow: boolean) => void) | null = null;
let quitting = false;
let talkBusy = false;
let startInProgress = false;
let displayRequest: {
  resolve: (allow: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const target = () =>
  screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay();

function snapshot(): Snapshot {
  return {
    selectingDisplay: !!displayRequest,
    voice: voice.state,
    revision,
    session: session ? { id: session.id, topic: session.topic, phase: session.phase } : null,
    messages: session?.messages || [],
    input: input.state,
    guides,
    guidesHidden,
    userBoard,
    editing,
    collapsed,
    settings,
    capture: captureState,
    connection,
    displays: screen.getAllDisplays().map((d) => ({
      id: d.id,
      label: d.label || `屏幕 ${d.id}`,
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
    })),
    displayId: target().id,
    error,
  };
}
function broadcast() {
  revision++;
  if (!app.isReady()) return;
  const state = snapshot();
  if (!guides.some((g) => g.type === 'html')) htmlHost.clear();
  else htmlHost.visible(!guidesHidden);
  for (const w of [panel, overlay])
    if (w && !w.isDestroyed()) w.webContents.send('companion:state', state);
}
function fail(e: unknown) {
  error = e instanceof Error ? e.message : String(e);
  broadcast();
}
function ours(handle: string) {
  return BrowserWindow.getAllWindows().some((w) => {
    const b = w.getNativeWindowHandle();
    return (b.length >= 8 ? b.readBigUInt64LE(0) : BigInt(b.readUInt32LE(0))).toString() === handle;
  });
}
async function foreground() {
  const current = await windows.foreground();
  if (current && current !== '0' && !ours(current)) {
    lastExternal = current;
    if (current !== lastForeground && !quitting) {
      if (overlay && !overlay.isDestroyed() && overlay.isVisible() && !overlay.isMinimized())
        overlay.moveTop();
      if (panel && !panel.isDestroyed() && panel.isVisible() && !panel.isMinimized())
        panel.moveTop();
    }
  }
  lastForeground = current;
  return lastExternal;
}
function setBounds(height: number) {
  if (movingPanel) return;
  const display =
    screen.getAllDisplays().find((d) => d.id === panelPosition?.displayId) || target();
  const bounds = panelBounds(height, collapsed, display.workArea, panelPosition);
  const current = panel.getBounds();
  if (
    Object.entries(bounds).some(
      ([key, value]) => Math.abs(current[key as keyof typeof current] - value) > 1,
    )
  )
    panel.setBounds(bounds);
}
function place() {
  const d = target();
  overlay.setBounds(d.bounds);
  setBounds(collapsed ? collapsedHeight : expandedHeight);
}
function finishPanelMove() {
  movingPanel = false;
  const bounds = panel.getBounds();
  const display = screen.getDisplayMatching(bounds);
  panelPosition = {
    version: 1,
    displayId: display.id,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
  };
  setBounds(collapsed ? collapsedHeight : expandedHeight);
  const clamped = panel.getBounds();
  panelPosition.right = clamped.x + clamped.width;
  panelPosition.bottom = clamped.y + clamped.height;
  fs.writeFile(path.join(home, 'panel-position.json'), JSON.stringify(panelPosition)).catch((e) =>
    runtimeEvent('panel-position-save-failed', failureMetadata(e)),
  );
  autoCollapse();
}
function expand() {
  if (collapsed) {
    collapsed = false;
    setBounds(expandedHeight);
  }
  broadcast();
  autoCollapse();
}
function autoCollapse() {
  if (collapseTimer) clearTimeout(collapseTimer);
  if (
    !collapsed &&
    !movingPanel &&
    !hover &&
    !panel.isFocused() &&
    input.state.phase === 'idle' &&
    !captureState &&
    !connection &&
    settings.autoCollapseSec > 0
  ) {
    collapseTimer = setTimeout(() => {
      if (
        input.state.phase === 'idle' &&
        !movingPanel &&
        !hover &&
        !panel.isFocused() &&
        !captureState &&
        !connection
      ) {
        collapsed = true;
        setBounds(collapsedHeight);
        broadcast();
      }
    }, settings.autoCollapseSec * 1000);
  }
}
function requireSession() {
  if (!session || session.phase === 'ended') throw new Error('请先让 Agent start 开始一次教学');
  return session;
}
async function readSettings() {
  try {
    settings = settingsSchema.parse(
      JSON.parse(await fs.readFile(path.join(home, 'settings.json'), 'utf8')),
    );
  } catch {
    settings = { ...defaults };
  }
}
async function saveSettings() {
  await fs.writeFile(path.join(home, 'settings.json'), JSON.stringify(settings, null, 2));
}
function applyCaptureVisibility() {
  for (const window of [panel, overlay])
    if (window && !window.isDestroyed())
      window.setContentProtection(captureProtected || !settings.showInScreenCapture);
  htmlHost.setCaptureVisible(!captureProtected && settings.showInScreenCapture);
}

let captureProtected = false;
let captureTail: Promise<unknown> = Promise.resolve();
async function captureScreen(): Promise<Shot> {
  const capturingSession = requireSession();
  const task = captureTail
    .catch(() => {})
    .then(async () => {
      const d = target();
      captureProtected = true;
      applyCaptureVisibility();
      let sources;
      try {
        await wait(35);
        sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: {
            width: Math.round(d.size.width * d.scaleFactor),
            height: Math.round(d.size.height * d.scaleFactor),
          },
        });
      } finally {
        captureProtected = false;
        applyCaptureVisibility();
      }
      const source = sources.find((s) => s.display_id === String(d.id));
      if (!source || source.thumbnail.isEmpty()) throw new Error('该屏幕无法截取，请更换屏幕');
      const raw = source.thumbnail;
      const rawSize = raw.getSize();
      const ratio = Math.min(1, IMAGE_EDGE / Math.max(rawSize.width, rawSize.height));
      const image =
        ratio < 1
          ? raw.resize({
              width: Math.round(rawSize.width * ratio),
              height: Math.round(rawSize.height * ratio),
            })
          : raw;
      const size = image.getSize();
      if (session !== capturingSession || capturingSession.phase === 'ended')
        throw new Error('教学已变更，截图已作废');
      const id = `s${++shotSequence}`;
      const dir = path.join(home, 'sessions', capturingSession.id, 'shots');
      await fs.mkdir(dir, { recursive: true });
      const file = path.join(dir, `${id}.png`);
      await fs.writeFile(file, image.toPNG());
      const originalFile = path.join(dir, `${id}-original.png`);
      await fs.writeFile(originalFile, raw.toPNG());
      originals.set(id, originalFile);
      const shot: Shot = {
        id,
        path: file,
        width: size.width,
        height: size.height,
        displayId: d.id,
        bounds: { ...d.bounds },
        scaleFactor: d.scaleFactor,
        at: Date.now(),
      };
      shots.set(id, shot);
      return shot;
    });
  captureTail = task;
  return task;
}
const input = new InputController({
  remember: foreground,
  capture: () => (settings.attachScreenshot ? captureScreen() : Promise.resolve(null)),
  focus: async () => {
    const turn = input.state.turnId;
    await setWindowInput(panel, true, true, windows);
    if (input.state.turnId !== turn || !['preparing', 'editing'].includes(input.state.phase))
      return;
    if (panel.isMinimized()) panel.restore();
    if (!panel.isVisible()) panel.show();
    if (!panel.isFocused()) panel.focus();
    if (!panel.isFocused()) {
      const handle = panel.getNativeWindowHandle();
      await windows.activate(
        (handle.length >= 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())).toString(),
      );
    }
    if (input.state.turnId === turn && panel.isFocused()) panel.webContents.focus();
  },
  restore: async (handle) => {
    await setWindowInput(panel, false, true, windows);
    if (input.state.phase !== 'idle') return;
    await windows.activate(handle);
    if (input.state.phase === 'idle' && panel.isFocused()) panel.blur();
    autoCollapse();
  },
  deliver: async (text, frames, id, attach) => {
    const s = requireSession();
    const epoch = userBoard.epoch;
    let all = frames;
    if (attach && (userBoard.count || guides.some((g) => g.type === 'stroke'))) {
      const dataUrl = await overlay.webContents.executeJavaScript(
        `window.companionBoard?.export(${epoch})`,
      );
      if (userBoard.epoch !== epoch || session !== s || s.phase === 'ended')
        throw new Error('画板或教学已变更，请重新发送');
      if (
        typeof dataUrl !== 'string' ||
        !dataUrl.startsWith('data:image/png;base64,') ||
        dataUrl.length > 32 * 1024 * 1024
      )
        throw new Error('画板导出失败');
      const png = nativeImage.createFromDataURL(dataUrl);
      if (png.isEmpty()) throw new Error('画板导出失败');
      const d = target();
      const shotId = `s${++shotSequence}`;
      const file = path.join(home, 'sessions', s.id, 'shots', `${shotId}-board.png`);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, png.toPNG());
      all = [
        ...all,
        {
          id: shotId,
          path: file,
          ...png.getSize(),
          displayId: d.id,
          bounds: { ...d.bounds },
          scaleFactor: d.scaleFactor,
          at: Date.now(),
        },
      ];
    }
    if (
      input.state.turnId !== id ||
      input.state.phase !== 'submitting' ||
      session !== s ||
      s.phase === 'ended'
    )
      throw new Error('输入已取消，附件已作废');
    if (attach && userBoard.epoch !== epoch) throw new Error('画板已变更，请重新发送');
    s.push(text, all, id);
    if (frames[0]) lastShot = frames[0];
  },
  changed: broadcast,
});
const voice = new VoiceController({
  prepare: async () => {
    requireSession();
    await input.prepare(false);
  },
  start: async () => {
    if (settings.voice.engine === 'system') {
      const id = voice.state.id;
      await systemSpeech.start((text) => {
        if (voice.state.id === id) voice.live(text);
      });
    }
  },
  stop: async () => {
    if (settings.voice.engine === 'system') return systemSpeech.stop();
    const payload = await new Promise<{ data: Uint8Array; mime: string }>((resolve, reject) => {
      pendingAudio = {
        resolve,
        reject,
        timer: setTimeout(() => {
          pendingAudio = null;
          reject(new Error('没有收到录音，请检查麦克风权限'));
        }, 8000),
      };
    });
    return transcribe(payload.data, payload.mime, settings.voice, path.join(home, 'audio'));
  },
  abort: () => {
    systemSpeech.abort();
    if (pendingAudio) {
      clearTimeout(pendingAudio.timer);
      pendingAudio.reject(new Error('录音已取消'));
      pendingAudio = null;
    }
  },
  submit: async (text) => {
    await input.submit(input.state.turnId!, text, true);
    expand();
  },
  cancel: () => input.cancel(),
  changed: broadcast,
  confirmMs: () => settings.voice.confirmMs,
});

function settleCapture(allow: boolean) {
  if (!captureRequest) return;
  const request = captureRequest;
  captureRequest = null;
  if (request.timer) clearTimeout(request.timer);
  captureState = null;
  request.resolve(allow);
  broadcast();
  autoCollapse();
}
async function approveCapture() {
  if (settings.captureTier === 'always') return true;
  if (captureRequest) throw new Error('已有截屏请求');
  const phase = settings.captureTier === 'lesson' ? 'countdown' : 'pending';
  captureState = { phase, remaining: phase === 'countdown' ? 3 : 0 };
  expand();
  return new Promise<boolean>((resolve) => {
    captureRequest = {
      resolve,
      timer: setTimeout(
        () => settleCapture(phase === 'countdown'),
        phase === 'countdown' ? 3000 : 60000,
      ),
    };
    broadcast();
  });
}
async function consent(kind: 'start' | 'attach', topic: string) {
  if (connectionRequest) throw new Error('已有连接请求待处理');
  connection = { kind, topic };
  expand();
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => connectionRequest?.(false), 30000);
    connectionRequest = (allow) => {
      clearTimeout(timer);
      connectionRequest = null;
      connection = null;
      broadcast();
      resolve(allow);
    };
    broadcast();
  });
}
async function action(a: Action) {
  switch (a.type) {
    case 'prepare':
      error = null;
      if (voice.state.phase !== 'idle') throw new Error('请先完成或撤回语音输入');
      requireSession();
      await input.prepare();
      break;
    case 'submit':
      await input.submit(a.turnId, a.text, a.attachBoard);
      break;
    case 'cancel':
      await input.cancel();
      break;
    case 'continue': {
      const s = requireSession();
      if (!['ready', 'waiting'].includes(s.phase) || input.state.phase !== 'idle')
        throw new Error('Agent 仍在处理中');
      await input.prepare();
      await input.submit(input.state.turnId!, settings.continueText, true);
      break;
    }
    case 'toggle-expanded':
      collapsed = !collapsed;
      setBounds(collapsed ? collapsedHeight : expandedHeight);
      autoCollapse();
      break;
    case 'hover':
      hover = a.on;
      autoCollapse();
      break;
    case 'resize':
      if (a.collapsed !== collapsed) break;
      if (collapsed) collapsedHeight = Math.min(560, a.height);
      else expandedHeight = Math.max(240, Math.min(560, a.height));
      setBounds(collapsed ? collapsedHeight : expandedHeight);
      break;
    case 'panel-drag': {
      if (a.phase === 'start') {
        pointerDrag = { id: a.dragId, bounds: panel.getBounds() };
        movingPanel = true;
        if (collapseTimer) clearTimeout(collapseTimer);
      } else if (pointerDrag?.id === a.dragId) {
        panel.setPosition(
          Math.round(pointerDrag.bounds.x + a.dx),
          Math.round(pointerDrag.bounds.y + a.dy),
        );
        if (a.phase === 'end') {
          pointerDrag = null;
          finishPanelMove();
        }
      }
      break;
    }
    case 'toggle-guides':
      guidesHidden = !guidesHidden;
      break;
    case 'clear':
      if (a.layer !== 'user') guides = [];
      if (a.layer !== 'agent') clearUserBoard();
      break;
    case 'edit':
      editing = a.on;
      overlay.setIgnoreMouseEvents(!editing);
      await setWindowInput(overlay, editing, false, windows);
      if (editing) {
        await foreground();
        if (!overlay.isVisible()) overlay.show();
        if (!overlay.isFocused()) overlay.focus();
        if (!overlay.isFocused()) {
          const handle = overlay.getNativeWindowHandle();
          await windows.activate(
            (handle.length >= 8
              ? handle.readBigUInt64LE()
              : BigInt(handle.readUInt32LE())
            ).toString(),
          );
        }
        if (editing && overlay.isFocused()) overlay.webContents.focus();
      } else {
        await windows.activate(lastExternal);
      }
      break;
    case 'board-change':
      if (a.epoch !== userBoard.epoch) return snapshot();
      userBoard = { ...userBoard, count: a.count };
      break;
    case 'settings':
      error = null;
      if (voice.state.phase !== 'idle') await voice.cancel();
      settings = a.settings;
      await saveSettings();
      applyCaptureVisibility();
      autoCollapse();
      break;
    case 'settings-focus':
      if (a.on) {
        await foreground();
        await setWindowInput(panel, true, true, windows);
        if (!panel.isVisible()) panel.show();
        if (!panel.isFocused()) panel.focus();
      } else if (input.state.phase === 'idle') {
        await setWindowInput(panel, false, true, windows);
        await windows.activate(lastExternal);
      }
      break;
    case 'capture-decision':
      if (a.decision === 'interrupt' && captureState?.phase === 'countdown') {
        if (captureRequest?.timer) clearTimeout(captureRequest.timer);
        captureState = { phase: 'pending', remaining: 0 };
        if (captureRequest) captureRequest.timer = setTimeout(() => settleCapture(false), 60000);
      } else settleCapture(a.decision === 'allow');
      break;
    case 'connection-decision':
      connectionRequest?.(a.allow);
      break;
    case 'select-display':
      if (!screen.getAllDisplays().some((d) => d.id === a.id)) throw new Error('屏幕已断开');
      await voice.cancel();
      await input.cancel();
      displayId = a.id;
      guides = [];
      clearUserBoard();
      lastShot = null;
      place();
      if (displayRequest) {
        clearTimeout(displayRequest.timer);
        displayRequest.resolve(true);
        displayRequest = null;
      }
      break;
    case 'end':
      await voice.cancel();
      session?.end();
      await input.cancel();
      guides = [];
      settleCapture(false);
      editing = false;
      overlay.setIgnoreMouseEvents(true);
      await setWindowInput(overlay, false, false, windows);
      break;
    case 'quit':
      await shutdown('panel-quit');
      break;
    case 'voice-start':
      requireSession();
      if (input.state.phase === 'editing') await input.cancel();
      if (input.state.phase !== 'idle') throw new Error('请先发送或取消文字输入');
      await voice.start();
      break;
    case 'voice-stop':
      await voice.stop();
      break;
    case 'voice-cancel':
      await voice.cancel();
      break;
    case 'voice-audio':
      if (a.id !== voice.state.id || voice.state.phase !== 'transcribing' || !pendingAudio)
        throw new Error('录音已失效');
      clearTimeout(pendingAudio.timer);
      pendingAudio.resolve({ data: a.data, mime: a.mime });
      pendingAudio = null;
      break;
    case 'voice-error':
      if (a.id === voice.state.id) await voice.fail(a.error);
      break;
  }
  broadcast();
  return snapshot();
}

async function body(req: IncomingMessage) {
  let count = 0;
  const chunks: Buffer[] = [];
  for await (const data of req) {
    count += data.length;
    if (count > 512 * 1024) throw new Error('请求过大');
    chunks.push(Buffer.from(data));
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
function checkDriver(req: IncomingMessage) {
  if (!session || req.headers['x-session-token'] !== session.token)
    throw new Error('需要有效教学连接，请 start 或 attach');
  return requireSession();
}
async function startServer() {
  const server = createServer(async (req, res) => {
    const respond = (code: number, value: unknown) => {
      if (!res.destroyed) {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(value));
      }
    };
    if (req.headers['x-companion-token'] !== auth) {
      respond(401, { error: 'authentication required' });
      return;
    }
    try {
      const route = new URL(req.url || '/', 'http://127.0.0.1').pathname;
      const data = req.method === 'POST' ? await body(req) : {};
      let result: unknown;
      if (route === '/status') {
        result = {
          session: snapshot().session,
          displayId: target().id,
          shots: [...shots.values()].slice(-10),
          home,
          version: '0.2.0',
        };
      } else if (route === '/start') {
        const topic = z.string().max(500).default('').parse(data.topic);
        if (session && session.phase !== 'ended') {
          if (req.headers['x-session-token'] === session.token)
            result = { id: session.id, token: session.token };
          else throw new Error('已有活跃教学，请先结束');
        } else {
          if (startInProgress) throw new Error('已有教学启动请求正在处理');
          startInProgress = true;
          try {
            const free = !!launchSecret && data.launchSecret === launchSecret;
            if (!free && !(await consent('start', topic))) throw new Error('用户拒绝连接');
            if (data.displayId !== undefined) {
              const selected = z.number().int().parse(data.displayId);
              if (!screen.getAllDisplays().some((d) => d.id === selected))
                throw new Error('指定屏幕不存在');
              if (selected !== target().id) clearUserBoard();
              displayId = selected;
              place();
            } else if (screen.getAllDisplays().length > 1) {
              const selected = await new Promise<boolean>((resolve) => {
                displayRequest = {
                  resolve,
                  timer: setTimeout(() => {
                    displayRequest = null;
                    broadcast();
                    resolve(false);
                  }, 30000),
                };
                expand();
                broadcast();
              });
              if (!selected) throw new Error('尚未选择教学屏幕');
            }
            if (quitting) throw new Error('应用正在退出');
            launchSecret = '';
            await input.cancel();
            const hadSession = session !== null;
            session = new Session(topic, broadcast);
            guides = [];
            if (hadSession) clearUserBoard();
            lastShot = null;
            shots.clear();
            originals.clear();
            result = { id: session.id, token: session.token, home };
            broadcast();
          } finally {
            startInProgress = false;
          }
        }
      } else if (route === '/attach') {
        if (!session || data.session !== session.id) throw new Error('会话不存在');
        if (!(await consent('attach', session.topic))) throw new Error('用户拒绝连接');
        result = { id: session.id, token: session.token };
      } else if (route === '/stop') {
        await shutdown('api-stop');
        result = { ok: true };
      } else {
        const active = checkDriver(req);
        switch (route) {
          case '/wait': {
            runtimeEvent('wait-start');
            const controller = new AbortController();
            res.on('close', () => {
              if (!res.writableEnded) controller.abort();
            });
            const messages = await active.wait(
              z.number().min(1).max(480000).default(480000).parse(data.timeoutMs),
              controller.signal,
            );
            runtimeEvent('wait-complete', { messages: messages.length });
            result = {
              messages,
              ended: active.phase === 'ended',
              timeout: !messages.length && active.phase !== 'ended',
            };
            break;
          }
          case '/ack':
            active.ack(z.number().int().parse(data.id));
            result = { ok: true };
            break;
          case '/say':
            active.say(z.string().trim().min(1).max(8000).parse(data.text));
            expand();
            result = { ok: true };
            break;
          case '/show': {
            const scene = parseScene(data);
            const shot = shots.get(scene.shot || lastShot?.id || '');
            if (!shot) throw new Error('先 capture 或接收用户截图后再画');
            if (shot.scaleFactor !== target().scaleFactor)
              throw new Error('屏幕缩放已变，请重新 capture');
            guides = mapGuides(scene, shot, { ...target().bounds }, target().id);
            const html = guides.filter(
              (g): g is Extract<Guide, { type: 'html' }> => g.type === 'html',
            );
            if (html.length > 1) throw new Error('每个场景最多一段 HTML');
            htmlHost.clear();
            if (html[0]) await htmlHost.show(html[0], target());
            active.say(scene.say);
            expand();
            result = { drawn: guides.length };
            break;
          }
          case '/clear':
            guides = [];
            if (data.all === true) clearUserBoard();
            result = { ok: true };
            break;
          case '/capture': {
            if (!(await approveCapture())) throw new Error('截屏未获允许');
            let shot: Shot | null = null;
            for (let n = 0; n < 3; n++) {
              try {
                shot = await captureScreen();
                break;
              } catch (e) {
                if (n === 2) throw e;
                await wait(200);
              }
            }
            lastShot = shot;
            result = { shot };
            break;
          }
          case '/zoom': {
            const source = shots.get(z.string().optional().parse(data.shot) || lastShot?.id || '');
            if (!source) throw new Error('截图不存在');
            const rect = z
              .tuple([
                z.number().int().nonnegative(),
                z.number().int().nonnegative(),
                z.number().int().positive(),
                z.number().int().positive(),
              ])
              .parse(data.rect);
            const resultShot = await zoomShot(
              source,
              originals.get(source.id),
              rect,
              `s${++shotSequence}`,
            );
            shots.set(resultShot.shot.id, resultShot.shot);
            originals.set(resultShot.shot.id, resultShot.original);
            lastShot = resultShot.shot;
            result = { shot: lastShot };
            break;
          }
          case '/board':
            result = {
              userStrokes: userBoard.count,
              userElements: userBoard.count,
              agentStrokes: guides.filter((g) => g.type === 'stroke').length,
            };
            break;
          default:
            respond(404, { error: 'unknown route' });
            return;
        }
        broadcast();
      }
      respond(200, result);
    } catch (e) {
      respond(400, { error: e instanceof Error ? e.message : String(e) });
    }
  });
  server.requestTimeout = 0;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('server failed');
  await fs.writeFile(
    endpointFile,
    JSON.stringify({ pid: process.pid, port: address.port, token: auth }),
    { mode: 0o600 },
  );
  return server;
}

async function shutdown(reason: string) {
  if (quitting) return;
  quitting = true;
  runtimeEvent('shutdown', { reason });
  htmlHost.clear();
  await voice.cancel();
  if (displayRequest) {
    clearTimeout(displayRequest.timer);
    displayRequest.resolve(false);
    displayRequest = null;
  }
  session?.end();
  await input.cancel();
  settleCapture(false);
  connectionRequest?.(false);
  await fs.rm(endpointFile, { force: true });
  setTimeout(() => app.quit(), 100);
}

async function loadWindow(w: BrowserWindow, mode: string) {
  if (process.env.TMA_DEV_URL) await w.loadURL(`${process.env.TMA_DEV_URL}?mode=${mode}`);
  else await w.loadFile(path.join(__dirname, '../ui/index.html'), { query: { mode } });
}
app
  .whenReady()
  .then(async () => {
    await fs.mkdir(home, { recursive: true });
    runtimeEvent('startup');
    await pruneSessions(home, 7);
    await readSettings();
    try {
      panelPosition = panelPositionSchema.parse(
        JSON.parse(await fs.readFile(path.join(home, 'panel-position.json'), 'utf8')),
      );
    } catch {
      panelPosition = null;
    }
    const preferences = {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    };
    panel = new BrowserWindow({
      title: 'Teach me, Agent',
      width: 360,
      height: 76,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      focusable: true,
      minimizable: false,
      skipTaskbar: false,
      alwaysOnTop: true,
      webPreferences: preferences,
    });
    overlay = new BrowserWindow({
      title: 'Teach me Overlay',
      ...target().bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      focusable: true,
      minimizable: false,
      skipTaskbar: true,
      hasShadow: false,
      alwaysOnTop: true,
      webPreferences: preferences,
    });
    for (const w of [panel, overlay]) {
      w.setContentProtection(!settings.showInScreenCapture);
      w.setAlwaysOnTop(true, 'screen-saver');
      w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      w.webContents.on('will-navigate', (e) => e.preventDefault());
    }
    await setWindowInput(panel, false, true, windows);
    await setWindowInput(overlay, false, false, windows);
    panel.on('show', () => panel.setSkipTaskbar(false));
    overlay.on('show', () => overlay.setSkipTaskbar(true));
    for (const [role, window] of [
      ['panel', panel],
      ['overlay', overlay],
    ] as const) {
      const log = (event: string) => () =>
        runtimeEvent(`window-${event}`, {
          role,
          visible: window.isVisible(),
          minimized: window.isMinimized(),
        });
      window.on('show', log('show'));
      window.on('hide', log('hide'));
      window.on('minimize', log('minimize'));
      window.on('restore', log('restore'));
      window.on('focus', log('focus'));
      window.on('blur', log('blur'));
    }
    overlay.setIgnoreMouseEvents(true);
    overlay.on('focus', () => {
      if (editing) overlay.webContents.focus();
    });
    applyCaptureVisibility();
    place();
    ipcMain.handle('companion:snapshot', (e) => {
      if (![panel.webContents.id, overlay.webContents.id].includes(e.sender.id))
        throw new Error('unknown sender');
      return snapshot();
    });
    ipcMain.handle('companion:action', async (e, value) => {
      if (![panel.webContents.id, overlay.webContents.id].includes(e.sender.id))
        throw new Error('unknown sender');
      const parsed = actionSchema.parse(value);
      if (e.sender.id === overlay.webContents.id && !['board-change', 'edit'].includes(parsed.type))
        throw new Error('overlay action rejected');
      if (parsed.type === 'board-change' && e.sender.id !== overlay.webContents.id)
        throw new Error('board sender rejected');
      try {
        return await action(parsed);
      } catch (err) {
        fail(err);
        throw err;
      }
    });
    await Promise.all([loadWindow(panel, 'panel'), loadWindow(overlay, 'overlay')]);
    overlay.showInactive();
    panel.showInactive();
    await startServer();
    let checking = false;
    fgTimer = setInterval(() => {
      session?.refreshConnection();
      if (!checking) {
        checking = true;
        foreground()
          .catch(() => {})
          .finally(() => {
            checking = false;
          });
      }
    }, 150);
    for (const [key, handler] of [
      [
        'Control+Alt+W',
        async () => {
          if (talkBusy) return;
          talkBusy = true;
          try {
            await wait(280);
            if (!(await windows.talkDown())) {
              await action({ type: 'prepare' });
              return;
            }
            const starting = action({ type: 'voice-start' });
            while (await windows.talkDown()) await wait(40);
            await voice.stop();
            await starting;
          } finally {
            talkBusy = false;
          }
        },
      ],
      ['Control+Alt+H', () => action({ type: 'toggle-guides' })],
    ] as const) {
      if (
        !globalShortcut.register(key, () => {
          Promise.resolve(handler()).catch(fail);
        })
      )
        fail(new Error(`快捷键 ${key} 被占用`));
    }
    screen.on('display-removed', () => {
      if (displayId && !screen.getAllDisplays().some((d) => d.id === displayId)) {
        displayId = null;
        guides = [];
        clearUserBoard();
        lastShot = null;
        input.cancel().catch(fail);
        fail(new Error('教学屏幕断开，请重新选屏'));
      }
      place();
      broadcast();
    });
    screen.on('display-metrics-changed', () => {
      guides = [];
      clearUserBoard();
      lastShot = null;
      place();
      broadcast();
    });
    panel.on('close', (e) => {
      if (!quitting) {
        e.preventDefault();
        shutdown('native-window-close').catch(fail);
      }
    });
    broadcast();
  })
  .catch((e) => {
    runtimeEvent('startup-failed', failureMetadata(e));
    console.error(e);
    app.exit(1);
  });
app.on('window-all-closed', () => {
  runtimeEvent('window-all-closed');
  app.quit();
});
app.on('before-quit', () => runtimeEvent('before-quit', { requested: quitting }));
app.on('quit', (_event, exitCode) => runtimeEvent('quit', { exitCode }));
app.on('will-quit', () => {
  runtimeEvent('will-quit');
  globalShortcut.unregisterAll();
  windows.dispose();
  if (fgTimer) clearInterval(fgTimer);
  if (collapseTimer) clearTimeout(collapseTimer);
});
app.on('render-process-gone', (_event, _contents, details) => {
  runtimeEvent('renderer-exit', { reason: details.reason, exitCode: details.exitCode });
});
app.on('child-process-gone', (_event, details) => {
  runtimeEvent('child-exit', {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
  });
});
