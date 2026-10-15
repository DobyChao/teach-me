// Dedicated host for one custom-HTML scene. No preload, no node, sandboxed.
// A crash or watchdog kill drops the document; nothing reloads it.
const { BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const { shouldRestoreHtmlAfterCrash, MIN_OPACITY } = require('../lib/html-sandbox');

const FRAME = path.join(__dirname, 'ui', 'html-frame.html');
const RSS_LIMIT = 512 * 1024 * 1024;

function readRss(pid) {
  if (!pid || process.platform !== 'linux') return null;
  try {
    const pages = Number(String(fs.readFileSync(`/proc/${pid}/statm`, 'utf8')).split(/\s+/)[1]);
    if (!Number.isFinite(pages)) return null;
    return pages * 4096;
  } catch {
    return null;
  }
}

function createHtmlHost({ log = () => {}, onCrash = () => {} } = {}) {
  let win = null;
  let watchdog = null;
  let ttl = null;

  function clearTimers() {
    if (watchdog) clearInterval(watchdog);
    if (ttl) clearTimeout(ttl);
    watchdog = null;
    ttl = null;
  }

  function destroy() {
    clearTimers();
    const w = win;
    win = null;
    if (w && !w.isDestroyed()) {
      try {
        w.webContents.removeAllListeners();
        w.removeAllListeners();
        w.destroy();
      } catch {}
    }
  }

  function failClosed() {
    destroy();
    if (!shouldRestoreHtmlAfterCrash()) onCrash();
  }

  function wire(w) {
    const wc = w.webContents;
    const blockMain = (event) => event.preventDefault();
    wc.on('will-navigate', blockMain);
    wc.on('will-redirect', blockMain);
    wc.on('will-frame-navigate', (event, url, isMainFrame) => {
      if (isMainFrame) return;
      const u = String(url || '');
      if (u.startsWith('about:') || u.startsWith('data:') || u.startsWith('blob:')) return;
      event.preventDefault();
    });
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    wc.on('render-process-gone', failClosed);
    wc.on('unresponsive', failClosed);
    try {
      wc.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
      wc.session.on('will-download', (event) => event.preventDefault());
      wc.session.webRequest.onBeforeRequest((details, cb) => {
        const u = String(details.url || '');
        const allow =
          u.startsWith('data:') ||
          u.startsWith('blob:') ||
          u.startsWith('about:') ||
          (u.startsWith('file:') && u.includes('html-frame.html'));
        cb({ cancel: !allow });
      });
    } catch (e) {
      log('html session hooks failed: ' + e.message);
    }
  }

  function arm(ttlMs, wc) {
    ttl = setTimeout(() => destroy(), Math.max(1, ttlMs || 60000));
    watchdog = setInterval(() => {
      if (!win || win.isDestroyed()) return;
      let pid = 0;
      try {
        pid = wc.getOSProcessId();
      } catch {
        return;
      }
      const rss = readRss(pid);
      if (rss != null && rss > RSS_LIMIT) failClosed();
    }, 2000);
  }

  async function show(payload) {
    destroy();
    try {
      await open(payload);
    } catch (e) {
      destroy();
      throw e;
    }
  }

  async function open(payload) {
    const opacity = Math.max(MIN_OPACITY, Number(payload.opacity) || MIN_OPACITY);
    win = new BrowserWindow({
      x: Math.round(payload.x),
      y: Math.round(payload.y),
      width: Math.max(32, Math.round(payload.width)),
      height: Math.max(32, Math.round(payload.height)),
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
        preload: undefined,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        backgroundThrottling: false,
        partition: `tma-html-${Date.now()}`,
      },
    });
    const current = win;
    current.setIgnoreMouseEvents(true);
    current.setFocusable(false);
    current.setAlwaysOnTop(true, 'screen-saver');
    if (payload.hideFromCapture) {
      try {
        current.setContentProtection(true);
      } catch {}
    }
    wire(current);
    const wc = current.webContents;
    try {
      wc.setAudioMuted(true);
    } catch {}
    await current.loadFile(FRAME);
    if (!win || win.isDestroyed() || win !== current) return;
    const body = JSON.stringify({ srcdoc: payload.srcdoc, opacity }).replace(/</g, '\\u003c');
    await wc.executeJavaScript(`window.renderScene(${body})`);
    if (!win || win.isDestroyed() || win !== current) return;
    current.showInactive();
    current.setAlwaysOnTop(true, 'screen-saver');
    arm(payload.ttlMs, wc);
  }

  function hide() {
    if (win && !win.isDestroyed()) win.hide();
  }

  function reveal() {
    if (win && !win.isDestroyed()) {
      win.showInactive();
      win.setAlwaysOnTop(true, 'screen-saver');
    }
  }

  return {
    show,
    hide,
    reveal,
    destroy,
    alive() {
      return !!(win && !win.isDestroyed() && win.isVisible());
    },
  };
}

module.exports = { createHtmlHost, readRss };
